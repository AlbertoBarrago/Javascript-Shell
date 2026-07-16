import { writeOutput } from './io.js';

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

  const handleCommand = async (commandName, commandArgs, stdoutFile, stdoutMode, stderrFile, stderrMode) => {
    if (commandName !== 'exit') {
      exitWarningShown = false;
    }

    switch (commandName) {
      case 'echo':
        writeOutput(commandArgs.join(' '), stdoutFile, stdoutMode);
        break;
      case 'cd':
        if (commandArgs.length === 0) {
          console.log('cd: missing operand');
        } else {
          const requestedDirectory = commandArgs[0];
          const targetDirectory = requestedDirectory === '~'
            ? process.env.HOME
            : requestedDirectory;

          try {
            process.chdir(targetDirectory);
          } catch {
            console.log(`cd: ${requestedDirectory}: No such file or directory`);
          }
        }
        break;
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
