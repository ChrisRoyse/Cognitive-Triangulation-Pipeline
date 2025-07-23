// Run pipeline with simplified concurrency settings for debugging

const { spawn } = require('child_process');

async function runSimplePipeline() {
    console.log('🚀 Running pipeline with low concurrency settings for debugging...');
    
    const env = {
        ...process.env,
        // Very low concurrency to avoid overload
        MAX_GLOBAL_CONCURRENCY: '2',
        MAX_FILE_ANALYSIS_WORKERS: '1',
        MAX_RELATIONSHIP_WORKERS: '1',
        MAX_VALIDATION_WORKERS: '1',
        MAX_RECONCILIATION_WORKERS: '1',
        // Disable adaptive scaling
        ADAPTIVE_CONCURRENCY: 'false',
        CIRCUIT_BREAKER_ENABLED: 'false',
        // Small batch sizes
        BATCH_SIZE: '5',
        FILE_BATCHING_ENABLED: 'false'
    };
    
    return new Promise((resolve, reject) => {
        const child = spawn('node', ['src/main.js', '--target', './polyglot-test'], {
            env,
            stdio: 'pipe'
        });
        
        child.stdout.on('data', (data) => {
            process.stdout.write(data);
        });
        
        child.stderr.on('data', (data) => {
            process.stderr.write(data);
        });
        
        child.on('close', (code) => {
            console.log(`\n🏁 Pipeline finished with code ${code}`);
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Pipeline failed with code ${code}`));
            }
        });
        
        // 5 minute timeout
        setTimeout(() => {
            child.kill();
            reject(new Error('Pipeline timed out'));
        }, 300000);
    });
}

runSimplePipeline().catch(console.error);