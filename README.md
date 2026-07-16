# JavaScript Shell

A small POSIX-style shell built in JavaScript as a study project.

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

- Node.js 25

Start the shell:

```sh
./your_program.sh
```

Run it directly with Node:

```sh
npm run dev
```

## Notes

This repository is a study project. The goal is to keep the implementation
readable and easy to evolve while keeping the shell usable from the command
line.
