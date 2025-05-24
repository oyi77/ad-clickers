const winston = require('winston');
const path = require('path');
const { app } = require('electron');
const fs = require('fs-extra');

const logDir = path.join(app.getPath('userData'), 'logs');

// Ensure the log directory exists
fs.ensureDirSync(logDir);

// Function to send logs to the UI (will be set by main process)
let sendLogToUI = (level, message) => {
  console.log(`[Renderer] ${level.toUpperCase()}: ${message}`);
};

function setUILogger(loggerFn) {
  sendLogToUI = loggerFn;
}

const logger = winston.createLogger({
  level: 'info', // Default log level
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.printf(info => `${info.timestamp} ${info.level.toUpperCase()}: ${info.message}`)
  ),
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(info => `${info.timestamp} ${info.level.toUpperCase()}: ${info.message}`)
      )
    }),
    // File transport for errors
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error'
    }),
    // File transport for combined logs
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log')
    })
  ]
});

// Custom transport to send logs to the UI
class UILogger extends winston.Transport {
  constructor(options) {
    super(options);
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    // Send log to UI if available
    sendLogToUI(info.level, info.message);

    callback();
  }
}

// Add the UI transport to the logger
logger.add(new UILogger());

module.exports = {
  logger,
  setUILogger
}; 