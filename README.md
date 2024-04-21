# HOL Light extension for VS Code

A simple HOL Light extension for Visual Studio Code. It supports basic syntax hihglighting and interaction with a HOL Light REPL in a terminal window.

## Requirements

HOL Light should be installed separately. See [HOL Light repository](https://github.com/jrh13/hol-light/) for installation instructions.

The extension is automatically activated for `.hl` files. If a HOL Light file has a different extension (e.g., `.ml`) then it is required to activate the extension manually by selecting `HOL Light` language mode.

The extension does not start a HOL Light REPL automatically. Whenever any command which interacts with HOL Light is invoked, a dialog will appear where a script for starting a HOL Light session should be selected. One possible choice is to select `hol.sh` from the HOL Light directory. Any other script can be also selected (e.g., `dmtcp_restart_script.sh` if DMTCP checkpointing is used).

## Main Commands

All commands can be invoked from the command palette or by pressing the corresponding keyboard shortcuts.

1) **HOL Light: Send selected text to HOL Light REPL** 

    Default shortcut: `Alt + E`
    
    Sends selected text to HOL Light. If no text is selected, then text at the cursor position separated by `;;` is sent to HOL Light and the cursor position is moved to the next statement.

1) **HOL Light: Set Current Term as a Goal**

    Default shortcut: `Alt + G`

    Sets the term at the current cursor position as a new goal. This command works when the cursor is inside a HOL Light term (a text inside back quotes).

1) **HOL Light: Execute Current Tactic (Multiple Lines)**

    Default shortcut: `Alt + M`

    Sends a tactic at the cursor line to HOL Light. If the tactic occupies several lines, all these lines are sent to HOL Light (the maximum number of lines is limited by the configuration parameter `tacticMaxLines` which is 30 by default). This command also moves the cursor to the next line after the tactic.

    Alternatively, it is possible to select arbitrary text with tactics and use this command to sent it to HOL Light.

1) **HOL Light: Execute Current Tactic**

    Default shortcut: `Alt + L`

    Sends a tactic at the cursor line to HOL Light. Only one line tactic could be processed with this command. This command also moves the cursor to the next line after the tactic.

    Alternatively, it is possible to select arbitrary text with tactics and use this command to sent it to HOL Light.

1) **HOL Light: Revert One Proof Step**

    Default shortcut: `Alt + B`

    Reverts one proof step.

1) **HOL Light: Print Current Goal**

    Default shortcut: `Alt + P`

    Prints the current goal in the HOL Light terminal.

1) **HOL Light: Rotate Subgoals**

    Default shortcut: `Alt + O`

    Rotates current subgoals.

1) **HOL Light: Send ^C to REPL**

    Default shortcut: `Alt + C`

    Sends `^C` to HOL Light.

1) **HOL Light: Search Theorems**

    Default shortcut: `Alt + S`

    Creates an input dialog where HOL Light theorems could be searched (all results will appear in a HOL Light REPL). Inputs in this dialog are either term patterns (with `_` wildcards; e.g., `_ + _ = _`) or names in double quotes (e.g., "ARITH"). Several search terms separated by a comma can be given (e.g., `_ + _ = _, "ARITH"`).

## Extension Settings

The extension adds the `HOL Light configuration` group to settings.

1) `hol-light.exePaths`: array of strings. Default: `[]`.

    An array of paths to HOL Light startup scripts. A new entry to this array is automatically added when a new script is selected in a file open dialog whenever a new HOL Light terminal is created.

1) `hol-light.tacticMaxLines`: number. Default: `30`.

    A number which specifies how many lines could be selected when a multiple line tactic is sent to HOL Light.

1) `hol-light.simpleSelection`: boolean. Default: `false`.

    A boolean flag which indicates whether to use a simple algorithm for selecting statements with the command *Send selected text to HOL Light REPL*. In general this flag should be `false`. But if you notice any slowdown for very large HOL Light files, then it could be because the standard statment selection algorithm is too slow and a less accurate simple algorithm could be used to improve performance.

## Known Issues

- Commands which select tactics may not work corretly for all possible tactics. It is always possible to select tactic text manually and send it to HOL Light.

- Type annotations inside HOL terms which occupy a single line are correctly highlighted only. The only recognized type constructors for highlighting are `list`, `group`, `finite_sum`, `word`.