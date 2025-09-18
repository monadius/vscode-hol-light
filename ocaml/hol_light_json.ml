module Json = struct

(* Copied from Yojson                                                 *)
(* https://github.com/ocaml-community/yojson/blob/master/lib/write.ml *)

let hex n =
  Char.chr (
    if n < 10 then n + 48
    else n + 87
  )

let write_special src start stop ob str =
  Buffer.add_substring ob src !start (stop - !start);
  Buffer.add_string ob str;
  start := stop + 1

let write_control_char src start stop ob c =
  Buffer.add_substring ob src !start (stop - !start);
  Buffer.add_string ob "\\u00";
  Buffer.add_char ob (hex (Char.code c lsr 4));
  Buffer.add_char ob (hex (Char.code c land 0xf));
  start := stop + 1

let finish_string src start ob =
  try
    Buffer.add_substring ob src !start (String.length src - !start)
  with exc ->
    Printf.eprintf "src=%S start=%i len=%i\n%!"
      src !start (String.length src - !start);
    raise exc

let write_string_body ob s =
  let start = ref 0 in
  for i = 0 to String.length s - 1 do
    match s.[i] with
        '"' -> write_special s start i ob "\\\""
      | '\\' -> write_special s start i ob "\\\\"
      | '\b' -> write_special s start i ob "\\b"
      | '\012' -> write_special s start i ob "\\f"
      | '\n' -> write_special s start i ob "\\n"
      | '\r' -> write_special s start i ob "\\r"
      | '\t' -> write_special s start i ob "\\t"
      | '\x00'..'\x1F' as c -> write_control_char s start i ob c
      | '\x7F' as c -> write_control_char s start i ob c
      | _ -> ()
  done;
  finish_string s start ob

let write_string ob s =
  Buffer.add_char ob '"';
  write_string_body ob s;
  Buffer.add_char ob '"'

let json_string_of_string s =
  let ob = Buffer.create 10 in
  write_string ob s;
  Buffer.contents ob

let write_null ob () =
  Buffer.add_string ob "null"

let write_bool ob x =
  Buffer.add_string ob (if x then "true" else "false")

let dec n =
  Char.chr (n + 48)

let rec write_digits s x =
  if x = 0 then ()
  else
    let d = x mod 10 in
    write_digits s (x / 10);
    Buffer.add_char s (dec (abs d))

let write_int ob x =
  if x > 0 then
    write_digits ob x
  else if x < 0 then (
    Buffer.add_char ob '-';
    write_digits ob x
  )
  else
    Buffer.add_char ob '0'

end;;

let write_to_string ?max_boxes writer =
  let buf = Buffer.create 1024 in
  let fmt = Format.formatter_of_buffer buf in
  (match max_boxes with
  | Some n -> Format.pp_set_max_boxes fmt 100
  | None -> ());
  fun arg ->
    Buffer.clear buf;
    let result = writer fmt arg in
    Format.pp_print_flush fmt ();
    result, Buffer.contents buf;;

let write_term ~color ?max_boxes ob t =
  let writer = if color then pp_print_colored_term else pp_print_term in
  let _, s = write_to_string ?max_boxes writer t in
  Json.write_string ob s;;

let write_list ob writer lst =
  Buffer.add_char ob '[';
  List.iteri (fun i x ->
    if i > 0 then Buffer.add_char ob ',';
    writer ob x
  ) lst;
  Buffer.add_char ob ']';;

let write_goal ~color ?max_boxes ob =
  let write_hyp ob (label, hyp) =
    Buffer.add_char ob '{';
    Buffer.add_string ob "\"label\":";
    Json.write_string ob label;
    Buffer.add_char ob ',';
    Buffer.add_string ob "\"term\":";
    write_term ~color ~max_boxes:!print_goal_hyp_max_boxes ob (concl hyp);
    Buffer.add_char ob '}'
  in
  fun (goal : goal) ->
    let hyps, tm = goal in
    Buffer.add_char ob '{';
    Buffer.add_string ob "\"hypotheses\":";
    write_list ob write_hyp hyps;
    Buffer.add_char ob ',';
    Buffer.add_string ob "\"term\":";
    write_term ~color ?max_boxes ob tm;
    Buffer.add_char ob '}';;

let write_goalstate ~color ?max_boxes ob (gs : goalstate) =
  let _, goals, _ = gs in
  write_list ob (write_goal ~color ?max_boxes) goals;;

let write_top_goalstate ~color ?max_boxes ob =
  let goals, subgoals =
    match !current_goalstack with
    | [] -> [], 0
    | [_, goals, _] -> goals, 1
    | (_, goals, _) :: (_, goals0, _) :: _ -> 
      let p = List.length goals - List.length goals0 in
      goals, if p < 1 then 1 else p + 1 in
  Buffer.add_char ob '{';
  Buffer.add_string ob "\"goals\":";
  write_list ob (write_goal ~color ?max_boxes) goals;
  Buffer.add_char ob ',';
  Buffer.add_string ob "\"subgoals\":";
  Json.write_int ob subgoals;
  Buffer.add_char ob '}';;

let json_of_top_goalstate ~color ~max_boxes =
  let ob = Buffer.create 1024 in
  write_top_goalstate ~color ?max_boxes ob;
  Buffer.contents ob;;