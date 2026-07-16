/**
 * Minimal ANSI color helpers with adaptive support detection.
 *
 * Colors are emitted only when the output is an interactive terminal that
 * declares color support. This mirrors the widely adopted conventions:
 * honor the NO_COLOR env var, skip colors when stdout is not a TTY (piped or
 * redirected), and treat `TERM=dumb` as "no colors".
 *
 * @see https://no-color.org
 */

const ANSI_CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

/**
 * Detect whether colored output should be emitted for the given stream.
 *
 * @param {NodeJS.WriteStream} [stream=process.stdout] - Stream to inspect.
 * @returns {boolean} True when ANSI colors are safe to emit.
 */
const supportsColor = (stream = process.stdout) => {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  if (process.env.TERM === 'dumb') {
    return false;
  }

  return Boolean(stream && stream.isTTY);
};

/**
 * Wrap text in an ANSI color code, or return it untouched when colors are
 * disabled for the current environment.
 *
 * @param {string} text - Text to colorize.
 * @param {keyof typeof ANSI_CODES} colorName - Color to apply.
 * @param {boolean} [enabled=supportsColor()] - Override for color support.
 * @returns {string} The colorized (or plain) text.
 */
const colorize = (text, colorName, enabled = supportsColor()) => {
  if (!enabled || ANSI_CODES[colorName] === undefined) {
    return text;
  }

  return `${ANSI_CODES[colorName]}${text}${ANSI_CODES.reset}`;
};

/**
 * Remove ANSI SGR escape sequences from a string. Useful to measure the
 * visible width of text that may contain color codes.
 *
 * @param {string} text - Text possibly containing ANSI color codes.
 * @returns {string} The text without ANSI SGR sequences.
 */
const stripAnsi = (text) => {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
};

export {
  colorize,
  stripAnsi,
  supportsColor,
};
