import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

const auraFormat = printf(({ level, message, timestamp, module, ...meta }) => {
  const mod = module ? ` [${module}]` : '';
  const extra = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} ${level}${mod} ${message}${extra}`;
});

export function createLogger(level = 'info'): winston.Logger {
  return winston.createLogger({
    level,
    format: combine(
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      colorize(),
      auraFormat,
    ),
    transports: [
      new winston.transports.Console(),
    ],
  });
}

export function childLogger(parent: winston.Logger, module: string): winston.Logger {
  return parent.child({ module });
}

export type Logger = winston.Logger;
