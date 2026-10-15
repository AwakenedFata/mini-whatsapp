let simulateDbFailure = process.env.SIMULATE_DB_FAILURE === 'true';

function isDbFailureSimulated() {
    return simulateDbFailure;
}

function setDbFailureSimulation(value) {
    simulateDbFailure = value;
    console.log(`[SIMULATION] Database failure simulation set to: ${value}`);
}

module.exports = {
    isDbFailureSimulated,
    setDbFailureSimulation
};
