export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private level: LogLevel = LogLevel.INFO;

  setLevel(level: LogLevel) {
    this.level = level;
  }

  log(level: LogLevel, message: string, ...args: any[]) {
    if (level >= this.level) {
      const levelNames = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
      const method = levelNames[level].toLowerCase() as keyof Console;
      const consoleMethod = typeof console[method] === 'function' ? (console[method] as Function) : console.log;
      consoleMethod(`[Resources Saver] ${message}`, ...args);
    }
  }

  debug(message: string, ...args: any[]) { this.log(LogLevel.DEBUG, message, ...args); }
  info(message: string, ...args: any[]) { this.log(LogLevel.INFO, message, ...args); }
  warn(message: string, ...args: any[]) { this.log(LogLevel.WARN, message, ...args); }
  error(message: string, ...args: any[]) { this.log(LogLevel.ERROR, message, ...args); }
}

export const logger = new Logger();
