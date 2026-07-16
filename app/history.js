import fs from 'node:fs';

/**
 * Create the command history store, with optional persistence to a file.
 *
 * @returns {object} The history API (in-memory list plus read/write helpers).
 */
const createHistory = () => {
  const commandHistory = [];
  let lastHistoryAppendIndex = 0;

  /**
   * Print history entries with 1-based indices.
   *
   * @param {number|null} limit - Show only the last `limit` entries, or all
   *   when `null`.
   * @param {string|null} stdoutFile - stdout redirection target, or `null`.
   * @param {'write'|'append'} stdoutMode - stdout redirection mode.
   * @param {Function} writeOutput - Output writer.
   * @returns {void}
   */
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

  /**
   * Append the entries of a history file to the in-memory history.
   *
   * @param {string} historyFilePath - Path to read from.
   * @returns {void}
   */
  const readHistoryFile = (historyFilePath) => {
    const fileContent = fs.readFileSync(historyFilePath, 'utf8');
    const commands = fileContent
      .split(/\r?\n/)
      .filter((command) => command !== '');

    commandHistory.push(...commands);
  };

  /**
   * Overwrite a history file with the full in-memory history.
   *
   * @param {string} historyFilePath - Path to write to.
   * @returns {void}
   */
  const writeHistoryFile = (historyFilePath) => {
    fs.writeFileSync(historyFilePath, `${commandHistory.join('\n')}\n`);
    lastHistoryAppendIndex = commandHistory.length;
  };

  /**
   * Append only the entries added since the last flush to a history file.
   *
   * @param {string} historyFilePath - Path to append to.
   * @returns {void}
   */
  const appendHistoryFile = (historyFilePath) => {
    const newCommands = commandHistory.slice(lastHistoryAppendIndex);

    if (newCommands.length > 0) {
      fs.appendFileSync(historyFilePath, `${newCommands.join('\n')}\n`);
    }

    lastHistoryAppendIndex = commandHistory.length;
  };

  /**
   * Load history from the file named by `HISTFILE`, if set and readable.
   *
   * @returns {void}
   */
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

  /**
   * Persist the in-memory history to `HISTFILE`, if set.
   *
   * @returns {void}
   */
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
