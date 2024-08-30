# HOL Light Extension for VS Code

A HOL Light extension for Visual Studio Code. It supports basic syntax highlighting and interaction with a HOL Light REPL in a terminal window. Autocompletion, hover messages, and Go to Definition features are also partially supported.

## Requirements

HOL Light should be installed separately. See [HOL Light repository](https://github.com/jrh13/hol-light/) for installation instructions. The path to a HOL Light installation should be manually set by modifying the `hol-light.path` option (it could be done by invoking the command `HOL Light: Set HOL Light Path` from the command palette).

The extension is automatically activated for `.hl` files. If a HOL Light file has a different file type (e.g., `.ml`) then it is required to activate the HOL Light extension manually by selecting `HOL Light` language mode. 

It is also possible to associate `.ml` files with the HOL Light extension by executing the command `HOL Light: Associate .ml Files with HOL Light`. This command adds the following lines to the workspace settings file:
```
    "files.associations": {
        "*.ml": "hol-light-ocaml"
    }
```
Other file types can be associated with HOL Light by adding the corresponding lines to the `files.associations` options in a settings file.

The extension does not start a HOL Light REPL automatically. Whenever any command which interacts with HOL Light is invoked, a dialog will appear where a script for starting a HOL Light session should be selected. One possible choice is to select `hol.sh` from the HOL Light directory. Any other script can also be selected (e.g., `dmtcp_restart_script.sh` if DMTCP checkpointing is used).

## Code Completion, Hover Info Messages, and Go to Definition

This extension provides autocompletion, hover info messages, and Go to Definition features for all  definitions and modules. These feature use a global index of definitions of all open HOL Light files and their dependencies. This index is automatically created and updated if the option `hol-light.autoIndex` is enabled (it is enabled by default). Alternatively, the index may be created (or updated) by invoking the command `HOL Light: Index File and its Dependencies`. Note that the exetension parsing algorithm is not perfect and it works for files where definitions are separated by `;;`.

Only explicitly imported dependencies are recongnized. That is, dependencies should be imported with `needs`, `loads`, or `loadt` commands followed by a string literal with a dependency path. Dependency files are searched relative to paths specified in `hol-light.rootPaths`. For example, if HOL Light of a project are located in the `src/proofs` directory then the following path should be added to `hol-light.rootPaths`: `{workspace}/src/proofs`.

If a project uses special commands for importing dependencies or for proving theorems, then it is possible to inform the parser about these commands by editing `hol-light.customImports`, `hol-light.customDefinitions`, or `hol-light.customTheorems` options.

Completion suggestions are also provided for imports after `needs`, `loads`, `loadt` and custom import commands. By default, suggestions do not appear automatically inside strings. One needs to trigger completion suggestions with `Ctrl + Space` after typing `needs "` (or other import commands). It is also possible to enable completion suggestions for all strings by changing the configuration option `Editor: Quick Suggestions` (`"editor.quickSuggestions": { "strings": "on" }`).

## Commands

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

1) **HOL Light: Remove Highlighting**

    Default shortcut: `Alt + D`

    Removes highlighting of the text sent to REPL from the active text document.

1) **HOL Light: Jump to Highlighted Text**

    Default shortcut: `Alt + J`

    Moves the cursor to the end of a highlighted text in the active text editor.

1) **HOL Light: Index File and its Dependencies**

    Parses the active file and its dependencies and adds definitions to a global index. This command should be invoked when `hol-light.autoIndex` is `false` or after updating `hol-light.rootPaths`.

1) **HOL Light: Set HOL Light Path**

    Opens a dialog where a path to HOL Light should be selected. This path is required for enabling autocompletion for items defined in the HOL Light `Help` directory.

1) **HOL Light: Associate .ml Files with HOL Light**

    Adds the `"*.ml": "hol-light-ocaml"` line to the `files.associations` option in the current workspace settings file.

Note: Text which is sent to a HOL Light REPL is highlighted. The highlighting color can be specified with the configuration option `hol-light.highlightColor`.

## Extension Settings

The extension adds the `HOL Light configuration` group to settings.

1) `hol-light.exePaths`: array of strings. Default: `[]`.

    An array of paths to HOL Light startup scripts. A new entry to this array is automatically added when a new script is selected in a file open dialog whenever a new HOL Light terminal is created.

1) `hol-light.path`: string.

    Path to a HOL Light directory. This path is required to enable autocompletion and related features for core HOL Light files.

1) `hol-light.rootPaths`: array of strings. Default: `[".", "{hol}", "{workspace}"]`

    An array of paths to locations containing HOL Light source files of a project. These paths are used by the extension to find dependencies of a file. The path value `"."` indicates that dependencies should be searched in the same directory as the current file. Paths may contain the following special tokens: `{hol}` is the path to a HOL Light installation, `{workspace}` is the current workspace root path.

    For example, if a project contains HOL Light files in the `src` directory then the following path should be added to `rootPaths`: `"{workspace}/src"`.

1) `hol-light.autoIndex`: boolean. Default `true`.

    If this option is `true` then all open files and their dependencies are automatically parsed and all definitions are added to a global index. If this option is `false` then it is still possible to index a file by invoking the `HOL Light: Index File and its Dependencies` command.

1) `hol-light.customImports`: string. Default `""`.

    By default, the extension parser recongnizes `needs`, `loads`, and `loadt` as import statements. Some projects may have other import statements. They can be specified in this option as statement names separated by commas or spaces.

    Note: custom import statements should take only one string argument.

1) `hol-light.customDefinitions`: string. Default `""`.

    The extension parser recognizes several HOL Light functions for creating definitions (e.g., `definition`, `new_definition`). Some projects may have custom functions for creating definitions. They can be specified in this option as function names separated by commas or spaces.

    Note: the first argument of custom definition functions should be a HOL Light term or a string.

1) `hol-light.customTheorems`: string. Default `""`.

    By default, the extension parser recognizes `prove` as a function for creating theorems. Some projects may have custom functions for creating theorems. They can be specified in this option as function names separated by commas or spaces.

    Note: the first argument of custom theorem functions should be a HOL Light term or a string.

1) `hol-light.tacticMaxLines`: number. Default: `30`.

    A number which specifies how many lines could be selected when a multiple line tactic is sent to HOL Light.

1) `hol-light.highlightColor`: string. Default: `editor.wordHighlightStrongBackground`

    Color for highlighting text sent to a HOL Light REPL. Could be either a reference to a color theme (see https://code.visualstudio.com/api/references/theme-color) or a color in the format ##RRGGBBAA. If this value is empty then the text is not highlighted.

## Known Issues

- Commands which select tactics may not work correctly for all possible tactics. Workaround: It is always possible to select tactic text manually and send it to HOL Light.

- Type annotations inside HOL terms which occupy several lines are not correctly highlighted. The only recognized type constructors for highlighting are `list`, `group`, `finite_sum`, `word`.

- The extension parser is not perfect and it may miss or incorrectly parse some definitions. In general, all definitions should be separated by `;;`.
