// Global state management
let isStopping = false;

function getStopState() {
  return isStopping;
}

function setStopState(state) {
  isStopping = state;
}

function resetStopState() {
  isStopping = false;
}

module.exports = {
  getStopState,
  setStopState,
  resetStopState
}; 