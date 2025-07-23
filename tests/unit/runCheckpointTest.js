// Simple test runner to bypass global setup issues
const { execSync } = require('child_process');

// Set environment to test
process.env.NODE_ENV = 'test';
process.env.LOG_ENABLED = 'false';

// Run the test directly without global setup
try {
    const result = execSync(
        'node node_modules/jest/bin/jest.js tests/unit/checkpointManager.test.js --no-watchman --maxWorkers=1 --globalSetup=""',
        { 
            stdio: 'inherit',
            env: {
                ...process.env,
                NODE_ENV: 'test',
                LOG_ENABLED: 'false'
            }
        }
    );
} catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
}