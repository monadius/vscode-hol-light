# Change Log

## 2.0.0
- All open HOL Light files and their dependencies are parsed and an index of top level definitions
  and modules is created. Top level definitions are used for implementing autocompletion, hover messages, 
  and Go to Definition features.
- New command `HOL Light: Index File and its Dependencies`: parses the current HOL Light file
  and its dependencies.
- New command `HOL Light: Associate .ml Files with HOL Light`: associates .ml files with HOL Light

## 1.2.0
- Bug fixes
- New command: remove highlighting
- New command: jump to highlighted text

## 1.1.0
- Highlight `CHEAT_TAC`, `new_axiom`, `mk_thm` with red color
- Autocompletion and hover messages for items defined in the HOL Light `Help` directory

## 1.0.0
- Matching brackets inside HOL terms
- Allow to select HOL Light scripts with an open file dialog

## 0.3.0
- A new algorithm for selecting statements and HOL terms which correctly handles comments and string literals
- Improved syntax highlighting for HOL type annotations
