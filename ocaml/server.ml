(* https://github.com/monadius/hol_server/blob/main/server.ml *)

let debug_flag = ref true

type redirected_descr = {
  new_descr : Unix.file_descr;
  mutable new_pos : int;
  mutable old_descr_dup : Unix.file_descr option;
  mutable old_descr : Unix.file_descr;
}

let create_redirected_descr fname = {
  new_descr = Unix.openfile fname [Unix.O_RDWR; Unix.O_TRUNC; Unix.O_CREAT] 0o666;
  new_pos = 0;
  old_descr_dup = None;
  old_descr = Unix.stdout;
}

let redirect old_descr redirect =
  match redirect.old_descr_dup with
  | Some _ -> failwith "The descriptor is already redirected"
  | None ->
    redirect.old_descr <- old_descr;
    redirect.old_descr_dup <- Some (Unix.dup old_descr);
    redirect.new_pos <- Unix.lseek redirect.new_descr 0 Unix.SEEK_CUR;
    Unix.dup2 redirect.new_descr old_descr

let restore redirect =
  match redirect.old_descr_dup with
  | None -> failwith "The descriptor is not redirected"
  | Some descr ->
    redirect.old_descr_dup <- None;
    Unix.dup2 descr redirect.old_descr;
    Unix.close descr

let rec really_read fd buffer start length =
  if length <= 0 then () else
    match Unix.read fd buffer start length with
    | 0 -> raise End_of_file
    | r -> really_read fd buffer (start + r) (length - r);;

let read_redirected redirect =
  try
    let pos = Unix.lseek redirect.new_descr 0 Unix.SEEK_END in
    let len = pos - redirect.new_pos in
    if len <= 0 then ""
    else
      let buffer = Bytes.create len in
      ignore (Unix.lseek redirect.new_descr redirect.new_pos Unix.SEEK_SET);
      really_read redirect.new_descr buffer 0 len;
      Bytes.to_string buffer
  with exn ->
    Printf.eprintf "Error reading the redirected file: %s"
      (Printexc.to_string exn);
    ""

let write_to_string writer =
  let buf = Buffer.create 1024 in
  let fmt = Format.formatter_of_buffer buf in
  Format.pp_set_max_boxes fmt 100;
  fun arg ->
    Buffer.clear buf;
    let result = writer fmt arg in
    Format.pp_print_flush fmt ();
    result, Buffer.contents buf

let try_finally (f, finally) arg =
  let result = try f arg with exn -> finally (); raise exn in
  finally (); 
  result

let rec restart_on_EINTR f x =
  try f x with Unix.Unix_error (Unix.EINTR, _, _) -> restart_on_EINTR f x

let rec toploop_service new_stdout new_stderr ic oc =
  let send_string ?(flush_output = false) prefix string =
    output_string oc prefix;
    output_string oc (String.escaped string);
    output_string oc "\n";
    if flush_output then flush oc 
  in
  Format.printf "[START] Connection open@.";
  send_string ~flush_output:true "info:" (Printf.sprintf "pid:%d" (Unix.getpid ()));
  let connected = ref true in
  while !connected do
    try
      send_string ~flush_output:true "ready" "";
      let raw_input = input_line ic in
      let input = 
        try Scanf.unescaped raw_input 
        with _ -> Format.eprintf "[ERROR] Bad input@."; raw_input in
      if !debug_flag then Format.printf "Input: %s@." input;
      if List.mem (String.trim input) ["#quit"; "#quit;;"] then raise End_of_file;
      let ok, result = begin
        try
          let finally () = 
            ignore (Unix.alarm 0);
            Format.pp_print_flush Format.std_formatter ();
            Format.pp_print_flush Format.err_formatter ();
            flush stdout; flush stderr;
            restore new_stdout; restore new_stderr in
          redirect Unix.stdout new_stdout;
          redirect Unix.stderr new_stderr;
          try_finally (write_to_string Toploop.use_input, finally) (Toploop.String input)
        with exn ->
          let exn_str = Printexc.to_string exn in
          if !debug_flag then Format.eprintf "[ERROR] %s@." exn_str; 
          false, exn_str
      end in
      let stdout_str = read_redirected new_stdout in
      let stderr_str = read_redirected new_stderr in
      send_string "stdout:" stdout_str;
      send_string "stderr:" stderr_str;
      send_string (if ok then "result:" else "rerror:") result;
      flush oc;
      flush stdout; 
      flush stderr
    with
    | End_of_file -> connected := false
    | Sys.Break -> Format.eprintf "Interrupted@."
  done;
  Format.printf "[STOP] Connection closed@."

let string_of_sockaddr = function
  | Unix.ADDR_UNIX s -> s
  | Unix.ADDR_INET (inet_addr, _) -> Unix.string_of_inet_addr inet_addr

let establish_forkless_server server_fun sockaddr =
  let domain = Unix.domain_of_sockaddr sockaddr in
  let sock = Unix.socket domain Unix.SOCK_STREAM 0 in
  try
    Unix.setsockopt sock Unix.SO_REUSEADDR true;
    Unix.bind sock sockaddr;
    Unix.listen sock 1;
    while true do
      let (s, caller) = restart_on_EINTR Unix.accept sock in
      Format.printf "Connection from: %s@." (string_of_sockaddr caller);
      let inchan = Unix.in_channel_of_descr s in
      let outchan = Unix.out_channel_of_descr s in
      let tmp_stdout = Filename.temp_file "stdout" "_tmp.txt" in
      let tmp_stderr = Filename.temp_file "stderr" "_tmp.txt" in
      let new_stdout = create_redirected_descr tmp_stdout in
      let new_stderr = create_redirected_descr tmp_stderr in
      let finally () =
        (* close_out closes the file descriptor so Unix.close s should not be called *)
        close_out outchan;
        (* close_in is not necessary *)
        close_in_noerr inchan;
        (try Sys.remove tmp_stdout with Sys_error _ -> ());
        (try Sys.remove tmp_stderr with Sys_error _ -> ())
      in
      try_finally (server_fun new_stdout new_stderr inchan, finally) outchan;
    done
  with 
  | Unix.Unix_error (Unix.EADDRINUSE, _, _) ->
    Unix.close sock;
    failwith "Address already in use"
  | exn ->
    Unix.close sock;
    Format.printf "[STOP] Server stopped@.";
    if exn = Sys.Break then
      Format.printf "Server Interrupted@."
    else
      raise exn

let get_host_address host_name =
  let host = Unix.gethostbyname host_name in
  host.Unix.h_addr_list.(0)

let start ?(host_name = "127.0.0.1") port =
  Sys.catch_break true;
  let address = get_host_address host_name in
  let start_server () = 
    Format.printf "Pid: %d; Host address: %s; port number: %d (no forks)@." 
    (Unix.getpid ()) (Unix.string_of_inet_addr address) port;
    flush_all();
    establish_forkless_server toploop_service (Unix.ADDR_INET (address, port)) in
  Unix.handle_unix_error start_server ()