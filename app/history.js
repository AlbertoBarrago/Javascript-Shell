import fs from 'node:fs';

const createHistory = () => {
  const commandHistory = [];
  let lastHistoryAppendIndex = 0;

  const printHistory = (limit, stdoutFile, stdoutMode, writeOutput) => {
    const startIndex = limit === null
      ? 0
      : Math.max(commandHistory.length - limit, 0);
    const lines = commandHistory.slice(startIndex).map((command, index) => {
      return `${String(startIndex + index + 1).padStart(5, ' ')}  ${command}`;
    });

    if (lines.length > 0) {
      writeOutput(lines.join('\n'), stdoutFile, stdoutMode);
    }
  };

  const readHistoryFile = (historyFilePath) => {
    const fileContent = fs.readFileSync(historyFilePath, 'utf8');
    const commands = fileContent
      .split(/\r?\n/)
      .filter((command) => command !== '');

    commandHistory.push(...commands);
  };

  const writeHistoryFile = (historyFilePath) => {
    fs.writeFileSync(historyFilePath, `${commandHistory.join('\n')}\n`);
    lastHistoryAppendIndex = commandHistory.length;
  };

  const appendHistoryFile = (historyFilePath) => {
    const newCommands = commandHistory.slice(lastHistoryAppendIndex);

    if (newCommands.length > 0) {
      fs.appendFileSync(historyFilePath, `${newCommands.join('\n')}\n`);
    }

    lastHistoryAppendIndex = commandHistory.length;
  };

  const loadHistoryFromEnvironment = () => {
    if (process.env.HISTFILE === undefined) {
      return;
    }

    try {
      readHistoryFile(process.env.HISTFILE);
      lastHistoryAppendIndex = commandHistory.length;
    } catch {
      // Ignore missing or unreadable history files.
    }
  };

  const saveHistoryToEnvironment = () => {
    if (process.env.HISTFILE !== undefined) {
      writeHistoryFile(process.env.HISTFILE);
    }
  };

  return {
    appendHistoryFile,
    commandHistory,
    loadHistoryFromEnvironment,
    printHistory,
    readHistoryFile,
    saveHistoryToEnvironment,
    writeHistoryFile,
  };
};

export {
  createHistory,
};
