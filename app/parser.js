import { REDIRECTION_OPERATORS } from './constants.js';

const parseCommandLine = (command) => {
  const args = [];
  let currentArg = '';
  let isInsideSingleQuotes = false;
  let isInsideDoubleQuotes = false;

  for (let index = 0; index < command.length; index++) {
    const char = command[index];

    if (char === '\\' && !isInsideSingleQuotes) {
      if (index + 1 < command.length) {
        currentArg += command[index + 1];
        index++;
      } else {
        currentArg += char;
      }
      continue;
    }

    if (char === "'" && !isInsideDoubleQuotes) {
      isInsideSingleQuotes = !isInsideSingleQuotes;
      continue;
    }

    if (char === '"' && !isInsideSingleQuotes) {
      isInsideDoubleQuotes = !isInsideDoubleQuotes;
      continue;
    }

    if (char === ' ' && !isInsideSingleQuotes && !isInsideDoubleQuotes) {
      if (currentArg !== '') {
        args.push(currentArg);
        currentArg = '';
      }
      continue;
    }

    if (char === '>' && !isInsideSingleQuotes && !isInsideDoubleQuotes) {
      const isAppendRedirection = command[index + 1] === '>';

      if (currentArg === '1' || currentArg === '2') {
        args.push(`${currentArg}${isAppendRedirection ? '>>' : '>'}`);
        currentArg = '';
        if (isAppendRedirection) {
          index++;
        }
        continue;
      }

      if (currentArg !== '') {
        args.push(currentArg);
        currentArg = '';
      }

      args.push(isAppendRedirection ? '>>' : '>');
      if (isAppendRedirection) {
        index++;
      }
      continue;
    }

    if (char === '|' && !isInsideSingleQuotes && !isInsideDoubleQuotes) {
      if (currentArg !== '') {
        args.push(currentArg);
        currentArg = '';
      }

      args.push(char);
      continue;
    }

    currentArg += char;
  }

  if (currentArg !== '') {
    args.push(currentArg);
  }

  return args;
};

const extractRedirection = (commandArgs) => {
  const redirections = {
    stdoutFile: null,
    stdoutMode: 'write',
    stderrFile: null,
    stderrMode: 'write',
  };
  const args = [];

  for (let index = 0; index < commandArgs.length; index++) {
    const arg = commandArgs[index];

    if (REDIRECTION_OPERATORS.includes(arg)) {
      const targetFile = commandArgs[index + 1] || null;
      const outputMode = arg.endsWith('>>') ? 'append' : 'write';

      if (arg === '2>' || arg === '2>>') {
        redirections.stderrFile = targetFile;
        redirections.stderrMode = outputMode;
      } else {
        redirections.stdoutFile = targetFile;
        redirections.stdoutMode = outputMode;
      }

      index++;
      continue;
    }

    args.push(arg);
  }

  return {
    args,
    ...redirections,
  };
};

const splitPipeline = (args) => {
  const pipeIndex = args.indexOf('|');

  if (pipeIndex === -1) {
    return null;
  }

  const commands = [];
  let currentCommand = [];

  for (const arg of args) {
    if (arg === '|') {
      commands.push(currentCommand);
      currentCommand = [];
      continue;
    }

    currentCommand.push(arg);
  }

  commands.push(currentCommand);
  return commands;
};

export {
  extractRedirection,
  parseCommandLine,
  splitPipeline,
};
