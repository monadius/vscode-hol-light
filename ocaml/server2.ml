exception Timeout
exception Sigpipe

let debug_flag = ref true

let () = Sys.set_signal Sys.sigpipe (Sys.Signal_handle (fun _ -> raise Sigpipe))
let () = Sys.set_signal Sys.sigalrm (Sys.Signal_handle (fun _ -> raise Timeout))

let rec restart_on_EINTR f x =
  try f x with Unix.Unix_error (Unix.EINTR, _, _) -> restart_on_EINTR f x

let write_to_string writer =
  let buf = Buffer.create 1024 in
  let fmt = Format.formatter_of_buffer buf in
  Format.pp_set_max_boxes fmt 100;
  fun arg ->
    Buffer.clear buf;
    let result = writer fmt arg in
    Format.pp_print_flush fmt ();
    result, Buffer.contents buf

let ($) f x = f x

(* Bind operators are not supported by HOL Light's Camlp5 *)
(*
let (let&) fd f =
  Fun.protect ~finally:(fun () -> Unix.close fd) (fun () -> f fd)

let (let&&) (fd1, fd2) f =
  let& fd1 = fd1 in
  let& fd2 = fd2 in
  f (fd1, fd2)
*)

let with_close fd f =
  Fun.protect ~finally:(fun () -> Unix.close fd) (fun () -> f fd)

let with_pipe f =
  let fdin, fdout = Unix.pipe () in
  with_close fdin $ fun fdin -> with_close fdout $ fun fdout -> f fdin fdout


let with_blocked ~signals f =
  let old_blocked = Thread.sigmask Unix.SIG_BLOCK signals in
  Fun.protect ~finally:(fun () -> ignore $ Thread.sigmask Unix.SIG_SETMASK old_blocked) f

(** Reads all available data from a given file descriptor *)
let drain : Unix.file_descr -> Buffer.t =
  let size = 16 * 1024 in
  let bytes = Bytes.create size in
  fun fdin ->
    let buf = Buffer.create size in
    Unix.set_nonblock fdin;
    Fun.protect ~finally:(fun () -> Unix.clear_nonblock fdin) $ fun () ->
      try
        let n = ref 1 in
        while !n > 0 do
          n := Unix.read fdin bytes 0 size;
          Buffer.add_subbytes buf bytes 0 !n;
        done;
        buf
      (* Catch all errors because Unix.Unix_error is not reliable if #load "unix.cma" is evaluated
        by the server: Old functions from the Unix module will throw errors from the new module. *)
      (* with Unix.Unix_error (Unix.EAGAIN, _, _) | Unix.Unix_error (Unix.EWOULDBLOCK, _, _) -> buf *)
      with _ -> buf

type redirected_descr = {
  new_descr : Unix.file_descr;
  mutable old_descr_dup : Unix.file_descr option;
  mutable old_descr : Unix.file_descr;
}

let create_redirected_descr fd = {
  new_descr = fd;
  old_descr_dup = None;
  old_descr = Unix.stdout;
}

let redirect old_descr redirected =
  match redirected.old_descr_dup with
  | Some _ -> failwith "The new descriptor is already redirected"
  | None ->
    redirected.old_descr <- old_descr;
    redirected.old_descr_dup <- Some (Unix.dup old_descr);
    Unix.dup2 redirected.new_descr old_descr

let restore redirected =
  match redirected.old_descr_dup with
  | None -> failwith "The descriptor is not redirected"
  | Some descr ->
    redirected.old_descr_dup <- None;
    Unix.dup2 descr redirected.old_descr;
    Unix.close descr

let toploop_eval input =
  write_to_string Toploop.use_input (Toploop.String input)

(* Returns (# total subgoals, # subgoals). Does what print_goalstate of HOL Light does *)
let hol_get_num_subgoals () =
  match !current_goalstack with
  | [] -> ""
  | (_,gl,_)::[] ->
    if List.length gl = 0 then ""
    else Format.sprintf "1,%d" (List.length gl)
  | (_,gl,_)::(_,glprev,_)::_ ->
    if List.length gl = 0 then ""
    else
      let p = length gl - length glprev in
      let p' = if p < 1 then 1 else p + 1 in
      Format.sprintf "%d,%d" p' (List.length gl)

let monitor_thread socket_ic socket_oc (labelled_fdins : (Unix.file_descr * string) list) =
  ignore (Thread.sigmask Unix.SIG_BLOCK [Sys.sigint]);
  let bytes_size = 16 * 1024 in
  let bytes = Bytes.create bytes_size in
  (* It is not a very good idea to use a buffered input for the socket:
     We rely on the fact that the client is well-behaved and always sends
     newline-terminated strings *)
  let socket_fd = Unix.descr_of_in_channel socket_ic in
  let fdins = socket_fd :: List.map fst labelled_fdins in
  let process fd =
    match List.assoc_opt fd labelled_fdins with
    | None -> begin
      (* Socket *)
      (* TODO: replace socket_ic with fdin: input_line could block *)
      let line = input_line socket_ic in
      match line with
      | "$interrupt" -> Unix.kill (Unix.getpid ()) Sys.sigint
      | _ -> if !debug_flag then Format.eprintf "[THREAD] Unexpected command: %s@." line
    end
    | Some label ->
      let n = Unix.read fd bytes 0 bytes_size in
      if label = "control" then
        raise End_of_file
      else begin
        (* If the client closes the connection then SIGPIPE signal will be generated *)
        (* TODO: these operations are potentially blocking *)
        output_string socket_oc label;
        output_char socket_oc ':';
        output_bytes socket_oc (Bytes.escaped (Bytes.sub bytes 0 n));
        output_char socket_oc '\n';
        flush socket_oc
      end
  in
  try
    while true do
      let rs, _, _ = Unix.select fdins [] [] (-1.) in
      List.iter process rs
    done
  with 
  | End_of_file -> (* prerr_endline "[THREAD] End_of_file: thread stopped" *) ()
  | exn -> Format.eprintf "[THREAD] Exception: %s@." $ Printexc.to_string exn; raise exn

let rec mt_service (ic, oc) =
  Format.printf "[START] Connection open@.";

  (* let&& fdin_stdout, fdout_stdout = Unix.pipe () in
  let&& fdin_stderr, fdout_stderr = Unix.pipe () in
  let&& fdin_ctrl, fdout_ctrl = Unix.pipe () in *)
  with_pipe $ fun fdin_stdout fdout_stdout ->
  with_pipe $ fun fdin_stderr fdout_stderr ->
  with_pipe $ fun fdin_ctrl fdout_ctrl ->

  let new_stdout = create_redirected_descr fdout_stdout in
  let new_stderr = create_redirected_descr fdout_stderr in
  let labelled_fdins = [fdin_stdout, "stdout"; fdin_stderr, "stderr"; fdin_ctrl, "control"] in
  let bytes = Bytes.create 1024 in

  let send_string ?(flush_output = false) prefix string =
    output_string oc prefix;
    output_string oc (String.escaped string);
    output_string oc "\n";
    if flush_output then flush oc 
  in

  let eval_input input =
    try
      let finally () = 
        Format.pp_print_flush Format.std_formatter ();
        Format.pp_print_flush Format.err_formatter ();
        flush stdout;
        flush stderr;
        (try restore new_stdout with _ -> ());
        (try restore new_stderr with _ -> ());
      in
      Fun.protect ~finally $ fun () -> 
        redirect Unix.stdout new_stdout;
        redirect Unix.stderr new_stderr;
        toploop_eval input
    with exn ->
      let exn_str = Printexc.to_string exn in
      if !debug_flag then Format.eprintf "[ERROR] %s@." exn_str; 
      false, exn_str
  in

  send_string ~flush_output:true "info:" (Printf.sprintf "interrupt:true;pid:%d" $ Unix.getpid ());

  let connected = ref true in
  while !connected do
    try
      (* Wait for the input *)
      send_string ~flush_output:true "ready:" (Printf.sprintf "subgoals:%s" $ hol_get_num_subgoals ());
      let raw_input = input_line ic in
      let input = 
        try String.trim (Scanf.unescaped raw_input)
        with _ -> Format.eprintf "[ERROR] Bad input@."; raw_input in
      (* Process special input cases *)
      if !debug_flag then Format.printf "Input: %s@." input;
      if input = "$interrupt" then raise Sys.Break;
      if List.mem input ["#quit"; "#quit;;"] then raise End_of_file;
      (* Start a monitor thread *)
      let t = Thread.create (monitor_thread ic oc) labelled_fdins in
      let stop_monitor () =
        (* prerr_endline "Stopping monitor"; *)
        ignore (Unix.single_write fdout_ctrl bytes 0 1);
        Thread.join t;
        (* prerr_endline "Thread joined"; *)
        (* If the thread is already stopped, we don't want to keep any data in the control pipe *)
        ignore (drain fdin_ctrl)
      in
      (* Evaluate the input *)
      let ok, result = Fun.protect ~finally:stop_monitor (fun () -> eval_input input) in
      (* Send the response to a client *)
      (* Sigpipe is raised here if the connection is broken *)
      let stdout_str = Buffer.contents (drain fdin_stdout) in
      let stderr_str = Buffer.contents (drain fdin_stderr) in
      send_string "stdout:" stdout_str;
      send_string "stderr:" stderr_str;
      send_string (if ok then "result:" else "rerror:") result;
      flush oc;
      flush stdout; 
      flush stderr;
    with
    | Sigpipe -> Format.eprintf "SIGPIPE@."; connected := false
    | End_of_file -> connected := false
    | Sys.Break -> Format.eprintf "Interrupted@."
  done;
  Format.printf "[STOP] Connection closed@."

let string_of_sockaddr = function
  | Unix.ADDR_UNIX s -> s
  | Unix.ADDR_INET (inet_addr, _) -> Unix.string_of_inet_addr inet_addr

let establish_forkless_server ?(single_connection = false) server_fun sockaddr =
  let domain = Unix.domain_of_sockaddr sockaddr in
  with_close (Unix.socket domain Unix.SOCK_STREAM 0) $ fun sock ->
  try
    Unix.setsockopt sock Unix.SO_REUSEADDR true;
    Unix.bind sock sockaddr;
    Unix.listen sock 1;
    while true do
      let (s, caller) = restart_on_EINTR Unix.accept sock in
      Format.printf "Connection from: %s@." (string_of_sockaddr caller);
      let inchan = Unix.in_channel_of_descr s in
      let outchan = Unix.out_channel_of_descr s in
      let finally () =
        (* close_out closes the file descriptor so Unix.close s should not be called *)
        (* We use close_out_noerr to avoid potential SIGPIPE errors *)
        close_out_noerr outchan;
      in
      Fun.protect ~finally (fun () -> server_fun (inchan, outchan));
      if single_connection then raise Sys.Break;
    done
  with 
  | Unix.Unix_error (Unix.EADDRINUSE, _, _) ->
    failwith "Address already in use"
  | exn ->
    Format.printf "[STOP] Server stopped@.";
    if exn = Sys.Break then
      Format.printf "Server Interrupted@."
    else
      raise exn

let get_host_address host_name =
  let host = Unix.gethostbyname host_name in
  host.Unix.h_addr_list.(0)

let start ?single_connection ?(host_name = "127.0.0.1") port =
  Sys.catch_break true;
  let address = get_host_address host_name in
  Format.printf "MT Server; PID: %d; Host address: %s; port number: %d (no forks)@." 
    $ Unix.getpid () $ Unix.string_of_inet_addr address $ port;
  flush_all();
  establish_forkless_server ?single_connection mt_service (Unix.ADDR_INET (address, port))
