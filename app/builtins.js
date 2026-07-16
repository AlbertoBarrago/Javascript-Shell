import { writeOutput } from './io.js';

/**
 * Create the builtin command handlers. Collaborators are injected so builtins
 * stay decoupled from the history, jobs, variables and completion subsystems.
 *
 * @param {object} deps - Injected collaborators.
 * @returns {{
 *   getBuiltinOutput: (commandName: string, commandArgs: string[]) => string,
 *   handleCommand: Function
 * }} The builtin API.
 */
const createBuiltins = ({
  appendHistoryFile,
  backgroundJobs,
  builtIns,
  completionSpecs,
  findExecutable,
  isValidShellIdentifier,
  printHistory,
  printJobs,
  readHistoryFile,
  saveHistoryToEnvironment,
  shellVariables,
  waitForBackgroundJobEvents,
  writeHistoryFile,
}) => {
  let exitWarningShown = false;

  // Directory stack, zsh-style: index 0 is always the current directory,
  // later entries are previously visited directories (most recent first).
  // Navigated with `cd -` (previous) and `cd -N` (Nth entry).
  const directoryStack = [process.cwd()];

  /**
   * Change directory and keep the directory stack and PWD/OLDPWD env vars in
   * sync. The resolved destination is moved to the front of the stack.
   *
   * @param {string} target - Absolute or relative destination path.
   * @returns {boolean} True on success, false if the directory is unreachable.
   */
  const changeDirectory = (target) => {
    const previousDirectory = process.cwd();

    try {
      process.chdir(target);
    } catch {
      return false;
    }

    const resolvedDirectory = process.cwd();
    const existingIndex = directoryStack.indexOf(resolvedDirectory);

    if (existingIndex !== -1) {
      directoryStack.splice(existingIndex, 1);
    }

    directoryStack.unshift(resolvedDirectory);
    process.env.OLDPWD = previousDirectory;
    process.env.PWD = resolvedDirectory;

    return true;
  };

  /**
   * Produce a builtin's output as a string, for use inside pipelines.
   *
   * @param {string} commandName - The builtin name.
   * @param {string[]} commandArgs - The builtin arguments.
   * @returns {string} The captured output (empty for builtins without stdout).
   */
  const getBuiltinOutput = (commandName, commandArgs) => {
    switch (commandName) {
      case 'echo':
        return `${commandArgs.join(' ')}\n`;
      case 'pwd':
        return `${process.cwd()}\n`;
      case 'type':
        if (commandArgs.length === 0) {
          return 'type: missing operand\n';
        }

        if (builtIns.includes(commandArgs[0])) {
          return `${commandArgs[0]} is a shell builtin\n`;
        }

        const executablePath = findExecutable(commandArgs[0]);
        return executablePath === null
          ? `${commandArgs[0]}: not found\n`
          : `${commandArgs[0]} is ${executablePath}\n`;
      default:
        return '';
    }
  };

  /**
   * Execute a builtin command, honoring stdout/stderr redirection.
   *
   * @param {string} commandName - The builtin name.
   * @param {string[]} commandArgs - The builtin arguments.
   * @param {string|null} stdoutFile - stdout redirection target, or `null`.
   * @param {'write'|'append'} stdoutMode - stdout redirection mode.
   * @param {string|null} stderrFile - stderr redirection target, or `null`.
   * @param {'write'|'append'} stderrMode - stderr redirection mode.
   * @returns {Promise<void>}
   */
  const handleCommand = async (commandName, commandArgs, stdoutFile, stdoutMode, stderrFile, stderrMode) => {
    if (commandName !== 'exit') {
      exitWarningShown = false;
    }

    switch (commandName) {
      case 'echo':
        writeOutput(commandArgs.join(' '), stdoutFile, stdoutMode);
        break;
      case 'cd': {
        if (commandArgs.length === 0) {
          console.log('cd: missing operand');
          break;
        }

        const requestedDirectory = commandArgs[0];
        const stackEntryMatch = requestedDirectory.match(/^-(\d*)$/);

        if (stackEntryMatch !== null) {
          const stackIndex = stackEntryMatch[1] === '' ? 1 : Number(stackEntryMatch[1]);
          const targetDirectory = directoryStack[stackIndex];

          if (targetDirectory === undefined) {
            console.log(`cd: ${requestedDirectory}: no such entry in dir stack`);
            break;
          }

          if (changeDirectory(targetDirectory)) {
            console.log(process.cwd());
          }

          break;
        }

        const targetDirectory = requestedDirectory === '~'
          ? process.env.HOME
          : requestedDirectory;

        if (!changeDirectory(targetDirectory)) {
          console.log(`cd: ${requestedDirectory}: No such file or directory`);
        }

        break;
      }
      case 'pwd':
        writeOutput(process.cwd(), stdoutFile, stdoutMode);
        break;
      case 'exit': {
        const hasRunningJobs = backgroundJobs.some((job) => job.status === 'Running');

        if (hasRunningJobs && !exitWarningShown) {
          console.log('There are running jobs.');
          exitWarningShown = true;
          break;
        }

        saveHistoryToEnvironment();
        process.exit(0);
        break;
      }
      case 'complete':
        if (commandArgs[0] === '-C' && commandArgs[1] !== undefined && commandArgs[2] !== undefined) {
          completionSpecs.set(commandArgs[2], commandArgs[1]);
        } else if (commandArgs[0] === '-r' && commandArgs[1] !== undefined) {
          completionSpecs.delete(commandArgs[1]);
        } else if (commandArgs[0] === '-p' && commandArgs[1] !== undefined) {
          const completerPath = completionSpecs.get(commandArgs[1]);

          if (completerPath !== undefined) {
            writeOutput(
              `complete -C '${completerPath}' ${commandArgs[1]}`,
              stdoutFile,
              stdoutMode,
            );
          } else {
            writeOutput(
              `complete: ${commandArgs[1]}: no completion specification`,
              stderrFile,
              stderrMode,
            );
          }
        }
        break;
      case 'jobs':
        await waitForBackgroundJobEvents();
        printJobs(stdoutFile, stdoutMode);
        break;
      case 'history':
        if (commandArgs[0] === '-r' && commandArgs[1] !== undefined) {
          readHistoryFile(commandArgs[1]);
        } else if (commandArgs[0] === '-w' && commandArgs[1] !== undefined) {
          writeHistoryFile(commandArgs[1]);
        } else if (commandArgs[0] === '-a' && commandArgs[1] !== undefined) {
          appendHistoryFile(commandArgs[1]);
        } else {
          printHistory(
            commandArgs[0] === undefined ? null : Number(commandArgs[0]),
            stdoutFile,
            stdoutMode,
            writeOutput,
          );
        }
        break;
      case 'declare':
        if (commandArgs[0] === '-p' && commandArgs[1] !== undefined) {
          const variableValue = shellVariables.get(commandArgs[1]);

          if (variableValue === undefined) {
            writeOutput(`declare: ${commandArgs[1]}: not found`, stderrFile, stderrMode);
          } else {
            writeOutput(`declare -- ${commandArgs[1]}="${variableValue}"`, stdoutFile, stdoutMode);
          }
        } else if (commandArgs[0] !== undefined && commandArgs[0].includes('=')) {
          const separatorIndex = commandArgs[0].indexOf('=');
          const variableName = commandArgs[0].slice(0, separatorIndex);
          const variableValue = commandArgs[0].slice(separatorIndex + 1);

          if (!isValidShellIdentifier(variableName)) {
            writeOutput(`declare: \`${commandArgs[0]}': not a valid identifier`, stderrFile, stderrMode);
            break;
          }

          shellVariables.set(variableName, variableValue);
        }
        break;
      default:
        writeOutput(`${commandName}: command not found`, stderrFile, stderrMode);
    }
  };

  return {
    getBuiltinOutput,
    handleCommand,
  };
};

export {
  createBuiltins,
};
