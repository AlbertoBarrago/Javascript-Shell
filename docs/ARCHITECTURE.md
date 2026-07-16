# Architecture

Technical reference for the JavaScript shell. It documents the module layout
and the main runtime flows, with Mermaid diagrams rendered natively by GitHub.

The shell is a Node.js REPL: it reads a line, parses it into tokens, expands
shell variables, decides whether the line is a pipeline or a single command,
handles redirection and background execution, runs a builtin or an external
program, then redraws the prompt. Every concern lives in its own module under
`app/`.

---

## 1. Module map

Each module is a factory (`createX`) that returns a small API. `shell.js` is the
composition root: it instantiates every collaborator and wires them together.

```mermaid
graph TD
  main[main.js<br/>entrypoint] --> shell[shell.js<br/>REPL + orchestration]

  shell --> parser[parser.js<br/>tokenize / redirection / pipeline]
  shell --> executor[executor.js<br/>PATH lookup + spawn]
  shell --> builtins[builtins.js<br/>builtin commands]
  shell --> completion[completion.js<br/>tab completion]
  shell --> history[history.js<br/>command history]
  shell --> jobs[jobs.js<br/>background jobs]
  shell --> variables[variables.js<br/>vars + expansion]
  shell --> io[io.js<br/>output + fd helpers]
  shell --> colors[colors.js<br/>ANSI + TTY detection]
  shell --> constants[constants.js<br/>BUILT_INS, operators]

  executor --> io
  builtins --> io
  executor -.calls back.-> builtins
```

Two wiring details worth noting:

- **`executor` ↔ `builtins` cycle is broken with a late binding.** The executor
  needs to run builtins inside pipelines, but builtins are created *after* the
  executor. `shell.js` passes the executor a closure over a `builtinHandlers`
  variable that is assigned right after, so the reference resolves lazily at
  call time rather than at construction time.
- **`constants.js` is the single source of truth** for the builtin list
  (`BUILT_INS`) and the redirection operators, shared by the parser, executor,
  completion and shell.

---

## 2. Command lifecycle

`handleLine` in `shell.js` is the heart of the REPL. Lines are processed
strictly in order: each `line` event chains onto a `pendingCommand` promise, so
an async command fully completes before the next line runs.

```mermaid
flowchart TD
  A[line event] --> B[trim input]
  B --> C{empty?}
  C -->|yes| P[redraw prompt]
  C -->|no| D[push to history]
  D --> E[parseCommandLine<br/>tokenize]
  E --> F["expandParameters<br/>$VAR and $&#123;VAR&#125;"]
  F --> G{contains a pipe?}

  G -->|yes| H[runPipeline] --> P
  G -->|no| I["extractRedirection<br/>split args from redirect ops"]
  I --> J{"trailing &amp; ?"}
  J -->|yes| K["mark background,<br/>drop the &amp;"]
  J -->|no| L[foreground]
  K --> M
  L --> M{command kind?}

  M -->|type| N[handleType] --> P
  M -->|builtin| O[create redirect files<br/>handleCommand<br/>exit code = 0] --> P
  M -->|external| Q[findExecutable]
  Q --> R{found?}
  R -->|no| S[command not found<br/>exit code = 127] --> P
  R -->|yes| T[create redirect files<br/>runExternalCommand]
  T --> U{background?}
  U -->|yes| V[register job,<br/>print job id] --> P
  U -->|no| W[capture exit code] --> P
```

Key ordering decision: **redirection target files are created only after the
command is known to exist.** A missing external command reports
`command not found` and returns before any `> file` is truncated, matching
shell behavior (a typo never clobbers an output file).

The captured exit code (`0` for builtins, the child's real code for externals,
`127` for not-found) is stored in `lastExitCode` and drives the prompt color.

### As a sequence

```mermaid
sequenceDiagram
  participant U as User
  participant RL as readline
  participant S as shell.handleLine
  participant P as parser
  participant V as variables
  participant X as executor

  U->>RL: types line + Enter
  RL->>S: 'line' event
  S->>P: parseCommandLine(line)
  P-->>S: tokens[]
  S->>V: expandParameters(tokens)
  V-->>S: expanded tokens[]
  S->>P: splitPipeline / extractRedirection
  P-->>S: commands or {args, redirections}
  S->>X: runExternalCommand / runPipeline
  X-->>S: {exitCode}
  S->>RL: setPrompt(colored) + prompt()
```

---

## 3. Parsing

`parseCommandLine` is a single-pass character scanner tracking quote state. It
handles backslash escaping, single quotes (literal), double quotes, whitespace
splitting, redirection operators (`>`, `>>`, and the `1`/`2` fd prefixes) and
the pipe symbol.

```mermaid
flowchart LR
  A[char] --> B{"escaped backslash?"}
  B -->|yes, outside single quotes| C[append next char literally]
  B -->|no| D{quote char?}
  D -->|quote| E[toggle quote state]
  D -->|no| F{whitespace<br/>outside quotes?}
  F -->|yes| G[flush current token]
  F -->|no| H{"redirect op (&gt; or &gt;&gt;)?"}
  H -->|yes| I[flush + push operator<br/>keep fd prefix 1/2]
  H -->|no| J{pipe outside quotes?}
  J -->|yes| K[flush + push pipe]
  J -->|no| L[append to current token]
```

Two derived passes run on the token list:

- **`extractRedirection`** walks the tokens, pulls out `>`/`>>`/`2>`/`2>>`
  operators plus their target filenames, and returns the remaining args along
  with `{stdoutFile, stdoutMode, stderrFile, stderrMode}`.
- **`splitPipeline`** slices the tokens on `|` into an array of command token
  arrays, or returns `null` when there is no pipe.

---

## 4. Pipeline execution

`runPipeline` picks one of two strategies depending on whether any stage is a
builtin.

```mermaid
flowchart TD
  A[runPipeline commands] --> B{any builtin<br/>in the pipeline?}

  B -->|no| C[runExternalPipeline]
  C --> C1[resolve every path,<br/>abort if one is missing]
  C1 --> C2[spawn all children]
  C2 --> C3[wire child N stdout<br/>to child N+1 stdin]
  C3 --> C4[first stdin / last stdout<br/>inherit the terminal]
  C4 --> C5[on last close:<br/>kill upstream, resolve]

  B -->|yes| D[sequential string piping]
  D --> D1[for each command:<br/>collectCommandOutput input]
  D1 --> D2["builtin: getBuiltinOutput string"]
  D1 --> D3["external: spawn,<br/>feed input via stdin,<br/>collect stdout"]
  D2 --> D4[output feeds next command]
  D3 --> D4
  D4 --> D5[write final output to stdout]
```

The all-external path uses real OS pipes (`child.stdout.pipe(next.stdin)`) for
streaming. The mixed path can't do that for builtins — they produce strings, not
file descriptors — so it degrades to buffering each stage's stdout as a string
and feeding it to the next stage's stdin.

---

## 5. Tab completion

`completeCommand` is the readline `completer`. What it completes depends on the
cursor position within the line.

```mermaid
flowchart TD
  A[completeCommand line] --> B{a space<br/>before the cursor?}
  B -->|no| C[completing the command word]
  C --> C1[candidates =<br/>builtins + PATH executables]
  B -->|yes| D[completing an argument]
  D --> E{command has a<br/>registered completer?}
  E -->|yes| F[run external completer,<br/>use its stdout lines]
  E -->|no| G[file/directory completion<br/>in the target directory]

  C1 --> H[completeFromCandidates]
  F --> H
  G --> H

  H --> H1{how many matches?}
  H1 -->|1| H2[insert completion,<br/>append space or keep /]
  H1 -->|0| H3[ring the bell]
  H1 -->|many| H4{common prefix<br/>longer than input?}
  H4 -->|yes| H5[extend to common prefix]
  H4 -->|no| H6[first Tab: bell;<br/>second Tab: list matches]
```

The double-Tab behavior is stateful: `previousCompletionPrefix` and
`previousCompletionHadMultipleMatches` remember the last attempt so the second
consecutive Tab on an ambiguous prefix prints the candidate list. This state is
reset at the start of every `handleLine`.

Registered completers follow the Bash `complete -C` convention: an external
program is invoked with `COMP_LINE`/`COMP_POINT` in the environment and the
command/word/previous-word as argv, and its stdout lines become the candidates.

---

## 6. Prompt and live highlighting

The prompt is rebuilt on every redraw and adapts to color support.

```mermaid
flowchart TD
  A[prompt] --> B[reap finished jobs]
  B --> C{supportsColor?<br/>NO_COLOR unset,<br/>TERM != dumb,<br/>stdout is a TTY}
  C -->|no| D["plain prompt"]
  C -->|yes| E["cyan cwd +<br/>green/red symbol<br/>by last exit code"]
  D --> F[setPrompt + render]
  E --> F
```

On a color-capable TTY, a `keypress` listener recolors the input line as you
type. It only touches the **command word** (the first token):

```mermaid
flowchart LR
  A[keypress] --> B{Enter or Tab?}
  B -->|yes| C[let readline render]
  B -->|no| D[refreshHighlightedLine]
  D --> E[clear line, rewrite prompt]
  E --> F{first token}
  F -->|builtin| G[green]
  F -->|in PATH| H[cyan]
  F -->|unknown| I[red]
  G --> J[restore cursor position]
  H --> J
  I --> J
```

The cursor is repositioned using `stripAnsi` to measure the prompt's *visible*
width (color codes have zero width). Enter and Tab are skipped so readline keeps
ownership of submission and completion rendering; the line recolors on the next
keystroke.

---

## 7. `cd` directory stack

`cd` maintains a zsh-style stack where index `0` is always the current
directory. `changeDirectory` keeps the stack, `PWD` and `OLDPWD` in sync.

```mermaid
flowchart TD
  A[cd arg] --> B{"arg matches -N ?"}
  B -->|yes| C[target = stack index N<br/>-, defaults to 1]
  C --> D{entry exists?}
  D -->|no| E[error: no such entry]
  D -->|yes| F[changeDirectory + print path]
  B -->|no| G[target = arg<br/>~ expands to HOME]
  G --> H[changeDirectory]
  H --> I{chdir ok?}
  I -->|no| J[error: no such file]
  I -->|yes| K[move dir to front of stack]
  F --> K
```

Because a visited directory is moved to the front (deduplicated), repeated
`cd -` toggles between the two most recent directories, exactly like zsh.

---

## 8. History and background jobs

**History** lives in memory and optionally syncs to `HISTFILE`.

```mermaid
stateDiagram-v2
  [*] --> Loaded: startup reads HISTFILE
  Loaded --> InMemory: each command pushed
  InMemory --> InMemory: history -r/-w/-a
  InMemory --> Saved: exit writes HISTFILE
  Saved --> [*]
```

`lastHistoryAppendIndex` tracks how much of the in-memory history has already
been flushed, so `history -a` appends only the new entries.

**Jobs** track background children (`cmd &`).

```mermaid
stateDiagram-v2
  [*] --> Running: background cmd spawned
  Running --> Done: child 'close' event
  Done --> Reaped: printed once, then removed
  Reaped --> [*]
```

Finished jobs are reported and reaped lazily before each prompt
(`reapDoneJobs`). `exit` with a still-`Running` job prints
`There are running jobs.` once and requires a second `exit` to force quit.

---

## Reading order for newcomers

1. `main.js` → `shell.js` (`createShell`, `handleLine`) — the control flow.
2. `parser.js` — how a string becomes tokens, redirections and pipelines.
3. `executor.js` — PATH lookup and the two pipeline strategies.
4. `builtins.js` — the builtin command table and `cd` stack.
5. `completion.js`, `history.js`, `jobs.js`, `variables.js`, `colors.js` — the
   supporting subsystems, readable in any order.
