/**
 * Process entrypoint: create the shell and start its REPL.
 */
import createShell from './shell.js';

const shell = createShell();

shell.start();
