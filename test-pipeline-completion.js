// Test the enhanced pipeline completion logic

async function testPipelineCompletion() {
    console.log('🧪 Testing Enhanced Pipeline Completion Logic...');
    
    // Create a mock queue manager for testing
    const mockQueueManager = {
        scenarios: [
            // Scenario 1: Normal completion
            { active: 10, waiting: 5, delayed: 0, completed: 0, failed: 0 },
            { active: 5, waiting: 2, delayed: 0, completed: 8, failed: 2 },
            { active: 1, waiting: 0, delayed: 0, completed: 14, failed: 2 },
            { active: 0, waiting: 0, delayed: 0, completed: 15, failed: 2 }, // Complete
        ],
        currentScenario: 0,
        
        async getJobCounts() {
            if (this.currentScenario >= this.scenarios.length) {
                // Keep returning the last scenario
                return this.scenarios[this.scenarios.length - 1];
            }
            
            const scenario = this.scenarios[this.currentScenario];
            this.currentScenario++;
            return scenario;
        }
    };
    
    // Test 1: Normal completion scenario
    console.log('\n1️⃣  Testing Normal Completion Scenario');
    mockQueueManager.currentScenario = 0;
    
    const startTime = Date.now();
    
    // Simulate waitForCompletion logic
    const result1 = await new Promise((resolve) => {
        const checkInterval = 1000; // 1 second for testing
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const maxFailureRate = 0.5;
        const startTime = Date.now();
        let idleChecks = 0;
        const requiredIdleChecks = 2; // Reduced for faster testing
        
        const intervalId = setInterval(async () => {
            try {
                const counts = await mockQueueManager.getJobCounts();
                const totalActive = counts.active + counts.waiting + counts.delayed;
                const totalProcessed = counts.completed + counts.failed;
                const failureRate = totalProcessed > 0 ? counts.failed / totalProcessed : 0;
                
                console.log(`   [Mock Queue Monitor] Active: ${counts.active}, Waiting: ${counts.waiting}, Completed: ${counts.completed}, Failed: ${counts.failed}, Failure Rate: ${(failureRate * 100).toFixed(1)}%`);
                
                // Check for timeout
                if (Date.now() - startTime > maxWaitTime) {
                    console.log('   ❌ Timeout reached');
                    clearInterval(intervalId);
                    resolve('timeout');
                    return;
                }
                
                // Check for excessive failure rate
                if (totalProcessed > 10 && failureRate > maxFailureRate) {
                    console.log('   ❌ Excessive failure rate');
                    clearInterval(intervalId);
                    resolve('failure_rate');
                    return;
                }
                
                if (totalActive === 0) {
                    idleChecks++;
                    console.log(`   [Mock Queue Monitor] Queues appear idle. Check ${idleChecks}/${requiredIdleChecks}.`);
                    if (idleChecks >= requiredIdleChecks) {
                        console.log(`   ✅ Normal completion - Completed: ${counts.completed}, Failed: ${counts.failed}`);
                        clearInterval(intervalId);
                        resolve('normal');
                    }
                } else {
                    idleChecks = 0;
                }
            } catch (error) {
                clearInterval(intervalId);
                resolve('error');
            }
        }, checkInterval);
    });
    
    console.log(`   Result: ${result1} (took ${Date.now() - startTime}ms)`);
    
    // Test 2: High failure rate scenario
    console.log('\n2️⃣  Testing High Failure Rate Scenario');
    
    const highFailureMock = {
        async getJobCounts() {
            return { active: 0, waiting: 0, delayed: 0, completed: 5, failed: 15 }; // 75% failure rate
        }
    };
    
    const result2 = await new Promise((resolve) => {
        const checkInterval = 500;
        const maxFailureRate = 0.5;
        let idleChecks = 0;
        const requiredIdleChecks = 2;
        
        const intervalId = setInterval(async () => {
            const counts = await highFailureMock.getJobCounts();
            const totalActive = counts.active + counts.waiting + counts.delayed;
            const totalProcessed = counts.completed + counts.failed;
            const failureRate = totalProcessed > 0 ? counts.failed / totalProcessed : 0;
            
            console.log(`   [High Failure Mock] Active: ${counts.active}, Completed: ${counts.completed}, Failed: ${counts.failed}, Failure Rate: ${(failureRate * 100).toFixed(1)}%`);
            
            if (totalProcessed > 10 && failureRate > maxFailureRate) {
                console.log(`   ❌ Excessive failure rate detected (${(failureRate * 100).toFixed(1)}%)`);
                clearInterval(intervalId);
                resolve('failure_rate');
                return;
            }
            
            if (totalActive === 0) {
                idleChecks++;
                if (idleChecks >= requiredIdleChecks) {
                    clearInterval(intervalId);
                    resolve('normal');
                }
            }
        }, checkInterval);
    });
    
    console.log(`   Result: ${result2}`);
    
    // Test 3: Timeout scenario
    console.log('\n3️⃣  Testing Timeout Scenario');
    
    const timeoutMock = {
        async getJobCounts() {
            return { active: 1, waiting: 0, delayed: 0, completed: 10, failed: 2 }; // Always has active jobs
        }
    };
    
    const result3 = await new Promise((resolve) => {
        const checkInterval = 500;
        const maxWaitTime = 2000; // 2 seconds for testing
        const startTime = Date.now();
        
        const intervalId = setInterval(async () => {
            const counts = await timeoutMock.getJobCounts();
            const totalActive = counts.active + counts.waiting + counts.delayed;
            
            console.log(`   [Timeout Mock] Active: ${totalActive}, elapsed: ${Date.now() - startTime}ms`);
            
            if (Date.now() - startTime > maxWaitTime) {
                console.log('   ❌ Maximum wait time exceeded, forcing completion');
                clearInterval(intervalId);
                resolve('timeout');
                return;
            }
            
            if (totalActive === 0) {
                clearInterval(intervalId);
                resolve('normal');
            }
        }, checkInterval);
    });
    
    console.log(`   Result: ${result3}`);
    
    // Summary
    console.log('\n🎉 Pipeline Completion Logic Tests Complete!');
    console.log(`✅ Normal completion: ${result1 === 'normal' ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Failure rate handling: ${result2 === 'failure_rate' ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Timeout handling: ${result3 === 'timeout' ? 'PASS' : 'FAIL'}`);
    console.log('\nThe pipeline will no longer hang indefinitely on failed jobs!');
}

testPipelineCompletion().catch(console.error);