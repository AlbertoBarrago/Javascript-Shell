# CodeCrafters Shell

A small POSIX-style shell built in JavaScript for the CodeCrafters
["Build Your Own Shell" challenge](https://app.codecrafters.io/courses/shell/overview).

[![progress-banner](https://backend.codecrafters.io/progress/shell/e363e877-7bc2-473c-8730-4e82decd5d24)](https://app.codecrafters.io/users/AlbertoBarrago?r=2qF)

## Features

- Interactive REPL with `$ ` prompt
- Builtins: `echo`, `cd`, `pwd`, `type`, `exit`, `complete`, `jobs`, `history`, `declare`
- External command execution through `PATH`
- Single and double quote parsing
- Backslash escaping
- Standard output and error redirection
- Append redirection
- Pipelines
- Background jobs
- Tab completion for commands, files, and registered completion handlers
- Persistent history through `HISTFILE`
- Shell variable declaration and parameter expansion

## Architecture

The shell is intentionally split into small CommonJS modules:

- `app/main.js`: process entrypoint
- `app/shell.js`: readline loop and command orchestration
- `app/parser.js`: command parsing, pipelines, and redirection extraction
- `app/executor.js`: executable lookup, external command execution, and pipelines
- `app/builtins.js`: builtin command behavior
- `app/completion.js`: tab completion logic
- `app/history.js`: in-memory and persistent command history
- `app/jobs.js`: background job tracking
- `app/variables.js`: shell variables and parameter expansion
- `app/io.js`: output and file descriptor helpers
- `app/constants.js`: shared shell constants

## Development

Requirements:

- Node.js 25, as expected by the CodeCrafters environment
- The CodeCrafters CLI for remote challenge tests

Run the shell locally:

```sh
./your_program.sh
```

Run it directly with Node:

```sh
npm run dev
```

Submit the full challenge test suite:

```sh
codecrafters submit
```

## Notes

This repository is a study project. The goal is to keep the implementation
readable and easy to evolve while preserving the behavior required by the
CodeCrafters tester.
