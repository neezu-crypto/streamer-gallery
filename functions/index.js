const { initializeApp } = require('firebase-admin/app');
initializeApp();

module.exports = {
  ...require('./src/whoami'),
  ...require('./src/r2'),
};
