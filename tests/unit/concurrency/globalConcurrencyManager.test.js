/**
 * Unit Tests for Global Concurrency Manager
 * 
 * Tests the global semaphore-based concurrency control system that ensures
 * we never exceed 100 concurrent workers across the entire system.
 * 
 * Test Scenarios:
 * 1. Basic semaphore acquisition and release
 * 2. Hard limit enforcement (100 workers max)
 * 3. Fair scheduling and queueing
 * 4. Priority-based resource allocation
 * 5. Resource starvation prevention
 * 6. Integration with worker pool manager
 * 7. Performance overhead measurement
 * 8. Error handling and recovery
 */

// Mock external dependencies
require('../../jest.mocks');

const { GlobalConcurrencyManager } = require('../../../src/utils/globalConcurrencyManager');
const { EventEmitter } = require('events');

describe('GlobalConcurrencyManager', () => {
    let manager;
    
    beforeEach(() => {
        manager = new GlobalConcurrencyManager({
            maxConcurrency: 100,
            acquireTimeout: 5000,
            enablePriorities: true
        });
    });
    
    afterEach(async () => {
        if (manager) {
            await manager.shutdown();
        }
    });
    
    describe('Basic Semaphore Operations', () => {
        test('should acquire and release permits', async () => {
            const permit = await manager.acquire('test-worker');
            expect(permit).toBeDefined();
            expect(permit.id).toBeDefined();
            expect(permit.workerType).toBe('test-worker');
            expect(manager.getCurrentConcurrency()).toBe(1);
            
            await manager.release(permit.id);
            expect(manager.getCurrentConcurrency()).toBe(0);
        });
        
        test('should track active permits by worker type', async () => {
            const permit1 = await manager.acquire('file-analysis');
            const permit2 = await manager.acquire('file-analysis');
            const permit3 = await manager.acquire('validation');
            
            const stats = manager.getWorkerStats();
            expect(stats['file-analysis'].active).toBe(2);
            expect(stats['validation'].active).toBe(1);
            expect(stats.total.active).toBe(3);
            
            await manager.release(permit1.id);
            await manager.release(permit2.id);
            await manager.release(permit3.id);
        });
        
        test('should handle multiple concurrent acquisitions', async () => {
            const promises = [];
            const workerCount = 50;
            
            for (let i = 0; i < workerCount; i++) {
                promises.push(manager.acquire(`worker-${i % 5}`));
            }
            
            const permits = await Promise.all(promises);
            expect(permits).toHaveLength(workerCount);
            expect(manager.getCurrentConcurrency()).toBe(workerCount);
            
            // Release all permits
            await Promise.all(permits.map(permit => manager.release(permit.id)));
            expect(manager.getCurrentConcurrency()).toBe(0);
        });
    });
    
    describe('Hard Limit Enforcement', () => {
        test('should enforce maximum concurrency limit', async () => {
            // Acquire maximum permits
            const permits = [];
            for (let i = 0; i < 100; i++) {
                permits.push(await manager.acquire(`worker-${i}`));
            }
            
            expect(manager.getCurrentConcurrency()).toBe(100);
            expect(manager.isAtCapacity()).toBe(true);
            
            // Attempt to acquire one more should timeout
            await expect(
                manager.acquire('overflow-worker', { timeout: 1000 })
            ).rejects.toThrow('Timeout waiting for concurrency permit');
            
            // Release one permit
            await manager.release(permits[0].id);
            expect(manager.getCurrentConcurrency()).toBe(99);
            expect(manager.isAtCapacity()).toBe(false);
            
            // Now acquisition should succeed
            const newPermit = await manager.acquire('overflow-worker', { timeout: 1000 });
            expect(newPermit).toBeDefined();
            
            // Cleanup
            await manager.release(newPermit.id);
            await Promise.all(permits.slice(1).map(p => manager.release(p.id)));
        });
        
        test('should queue requests when at capacity', async () => {
            // Fill up to capacity
            const permits = [];
            for (let i = 0; i < 100; i++) {
                permits.push(await manager.acquire(`worker-${i}`));
            }
            
            // Queue multiple requests
            const queuedPromises = [
                manager.acquire('queued-1'),
                manager.acquire('queued-2'),
                manager.acquire('queued-3')
            ];
            
            // Verify they're queued
            expect(manager.getQueueLength()).toBe(3);
            
            // Release permits in order
            await manager.release(permits[0].id);
            await manager.release(permits[1].id);
            await manager.release(permits[2].id);
            
            // Wait for queued requests to complete
            const queuedPermits = await Promise.all(queuedPromises);
            expect(queuedPermits).toHaveLength(3);
            expect(manager.getQueueLength()).toBe(0);
            
            // Cleanup
            await Promise.all(queuedPermits.map(p => manager.release(p.id)));
            await Promise.all(permits.slice(3).map(p => manager.release(p.id)));
        });
        
        test('should handle burst requests gracefully', async () => {
            const burstSize = 200;
            const acquirePromises = [];
            
            // Create burst of requests
            for (let i = 0; i < burstSize; i++) {
                acquirePromises.push(
                    manager.acquire(`burst-${i}`, { timeout: 10000 })
                        .then(permit => ({ success: true, permit }))
                        .catch(error => ({ success: false, error }))
                );
            }
            
            const results = await Promise.all(acquirePromises);
            
            const successful = results.filter(r => r.success);
            const failed = results.filter(r => !r.success);
            
            expect(successful).toHaveLength(100); // Max capacity
            expect(manager.getCurrentConcurrency()).toBe(100);
            
            // Release all successful permits
            await Promise.all(
                successful.map(r => manager.release(r.permit.id))
            );
        });
    });
    
    describe('Priority-Based Allocation', () => {
        test('should respect worker priorities', async () => {
            // Configure priorities
            manager.setWorkerPriority('critical', 10);
            manager.setWorkerPriority('normal', 5);
            manager.setWorkerPriority('low', 1);
            
            // Fill to capacity with low priority
            const lowPriorityPermits = [];
            for (let i = 0; i < 100; i++) {
                lowPriorityPermits.push(await manager.acquire('low'));
            }
            
            // Queue requests with different priorities
            const criticalPromise = manager.acquire('critical');
            const normalPromise = manager.acquire('normal');
            const lowPromise = manager.acquire('low');
            
            // Release one permit
            await manager.release(lowPriorityPermits[0].id);
            
            // Critical should be served first
            const criticalPermit = await criticalPromise;
            expect(criticalPermit.workerType).toBe('critical');
            
            // Release another
            await manager.release(lowPriorityPermits[1].id);
            
            // Normal should be served next
            const normalPermit = await normalPromise;
            expect(normalPermit.workerType).toBe('normal');
            
            // Cleanup
            await manager.release(criticalPermit.id);
            await manager.release(normalPermit.id);
            await Promise.all(lowPriorityPermits.slice(2).map(p => manager.release(p.id)));
            
            // Cancel the low priority request
            lowPromise.catch(() => {}); // Ignore rejection
        });
        
        test('should prevent starvation with fair scheduling', async () => {
            // Enable fair scheduling
            manager.enableFairScheduling(true);
            
            // Fill to near capacity
            const permits = [];
            for (let i = 0; i < 98; i++) {
                permits.push(await manager.acquire('high-priority'));
            }
            
            // Track acquisition order
            const acquisitionOrder = [];
            const promises = [];
            
            // Queue multiple requests
            for (let i = 0; i < 10; i++) {
                const priority = i < 5 ? 'high-priority' : 'low-priority';
                promises.push(
                    manager.acquire(priority).then(permit => {
                        acquisitionOrder.push(priority);
                        return permit;
                    })
                );
            }
            
            // Release permits gradually
            for (let i = 0; i < 10; i++) {
                await manager.release(permits[i].id);
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            const newPermits = await Promise.all(promises);
            
            // Verify fair distribution (not all high priority)
            const highPriorityCount = acquisitionOrder.filter(p => p === 'high-priority').length;
            const lowPriorityCount = acquisitionOrder.filter(p => p === 'low-priority').length;
            
            expect(highPriorityCount).toBeGreaterThan(0);
            expect(lowPriorityCount).toBeGreaterThan(0);
            
            // Cleanup
            await Promise.all(newPermits.map(p => manager.release(p.id)));
            await Promise.all(permits.slice(10).map(p => manager.release(p.id)));
        });
    });
    
    describe('Performance and Overhead', () => {
        test('should have minimal overhead for acquire/release', async () => {
            const iterations = 1000;
            const permits = [];
            
            const startTime = Date.now();
            
            // Rapid acquire/release cycles
            for (let i = 0; i < iterations; i++) {
                const permit = await manager.acquire('perf-test');
                permits.push(permit);
                
                if (i % 10 === 0) {
                    // Release some permits
                    const toRelease = permits.splice(0, 5);
                    await Promise.all(toRelease.map(p => manager.release(p.id)));
                }
            }
            
            const duration = Date.now() - startTime;
            const avgTime = duration / iterations;
            
            expect(avgTime).toBeLessThan(2); // Less than 2ms per operation
            
            // Cleanup
            await Promise.all(permits.map(p => manager.release(p.id)));
        });
        
        test('should handle concurrent operations efficiently', async () => {
            const concurrentOps = 50;
            const opsPerWorker = 20;
            
            const startTime = Date.now();
            
            const workers = Array(concurrentOps).fill(0).map((_, i) => {
                return (async () => {
                    for (let j = 0; j < opsPerWorker; j++) {
                        const permit = await manager.acquire(`worker-${i}`);
                        // Simulate work
                        await new Promise(resolve => setTimeout(resolve, 1));
                        await manager.release(permit.id);
                    }
                })();
            });
            
            await Promise.all(workers);
            
            const duration = Date.now() - startTime;
            const totalOps = concurrentOps * opsPerWorker;
            const throughput = totalOps / (duration / 1000);
            
            expect(throughput).toBeGreaterThan(100); // At least 100 ops/sec
        });
    });
    
    describe('Error Handling and Recovery', () => {
        test('should handle invalid permit releases', async () => {
            await expect(
                manager.release('invalid-permit-id')
            ).rejects.toThrow('Invalid permit ID');
            
            expect(manager.getCurrentConcurrency()).toBe(0);
        });
        
        test('should handle double releases', async () => {
            const permit = await manager.acquire('test');
            await manager.release(permit.id);
            
            await expect(
                manager.release(permit.id)
            ).rejects.toThrow('Permit already released');
        });
        
        test('should recover from worker crashes', async () => {
            const permit = await manager.acquire('crash-test');
            
            // Simulate crash by forcing permit expiry
            manager.forceExpirePermit(permit.id, 'Worker crashed');
            
            expect(manager.getCurrentConcurrency()).toBe(0);
            
            // Should be able to acquire again
            const newPermit = await manager.acquire('crash-test');
            expect(newPermit).toBeDefined();
            
            await manager.release(newPermit.id);
        });
        
        test('should handle timeout cleanup', async () => {
            // Configure short timeout
            const shortManager = new GlobalConcurrencyManager({
                maxConcurrency: 10,
                permitTimeout: 100 // 100ms timeout
            });
            
            const permit = await shortManager.acquire('timeout-test');
            
            // Wait for timeout
            await new Promise(resolve => setTimeout(resolve, 150));
            
            // Permit should be auto-released
            expect(shortManager.getCurrentConcurrency()).toBe(0);
            
            // Should not be able to release expired permit
            await expect(
                shortManager.release(permit.id)
            ).rejects.toThrow('Permit expired');
            
            await shortManager.shutdown();
        });
    });
    
    describe('Integration with Worker Pool', () => {
        test('should integrate with worker pool manager', async () => {
            const workerPool = {
                requestJobSlot: jest.fn(),
                releaseJobSlot: jest.fn()
            };
            
            manager.setWorkerPoolIntegration(workerPool);
            
            // Acquire through manager
            const permit = await manager.acquire('integrated-worker');
            
            // Verify worker pool was notified
            expect(workerPool.requestJobSlot).toHaveBeenCalledWith(
                'integrated-worker',
                expect.objectContaining({ globalPermitId: permit.id })
            );
            
            // Release through manager
            await manager.release(permit.id);
            
            // Verify worker pool was notified
            expect(workerPool.releaseJobSlot).toHaveBeenCalledWith(
                'integrated-worker',
                expect.objectContaining({ globalPermitId: permit.id })
            );
        });
        
        test('should emit events for monitoring', async () => {
            const events = [];
            
            manager.on('permitAcquired', (event) => events.push({ type: 'acquired', ...event }));
            manager.on('permitReleased', (event) => events.push({ type: 'released', ...event }));
            manager.on('permitQueued', (event) => events.push({ type: 'queued', ...event }));
            
            const permit = await manager.acquire('event-test');
            await manager.release(permit.id);
            
            expect(events).toHaveLength(2);
            expect(events[0].type).toBe('acquired');
            expect(events[0].workerType).toBe('event-test');
            expect(events[1].type).toBe('released');
            expect(events[1].workerType).toBe('event-test');
        });
    });
    
    describe('Monitoring and Metrics', () => {
        test('should provide comprehensive metrics', async () => {
            // Generate some activity
            const permits = [];
            for (let i = 0; i < 50; i++) {
                permits.push(await manager.acquire(`worker-${i % 5}`));
            }
            
            // Release half
            for (let i = 0; i < 25; i++) {
                await manager.release(permits[i].id);
            }
            
            const metrics = manager.getMetrics();
            
            expect(metrics.currentConcurrency).toBe(25);
            expect(metrics.maxConcurrency).toBe(100);
            expect(metrics.utilization).toBe(25);
            expect(metrics.totalAcquired).toBe(50);
            expect(metrics.totalReleased).toBe(25);
            expect(metrics.queueLength).toBe(0);
            expect(metrics.avgAcquireTime).toBeGreaterThan(0);
            expect(metrics.workerStats).toBeDefined();
            
            // Cleanup
            await Promise.all(permits.slice(25).map(p => manager.release(p.id)));
        });
        
        test('should track historical data', async () => {
            // Generate activity over time
            for (let i = 0; i < 10; i++) {
                const permit = await manager.acquire('history-test');
                await new Promise(resolve => setTimeout(resolve, 10));
                await manager.release(permit.id);
            }
            
            const history = manager.getHistoricalMetrics();
            
            expect(history.length).toBeGreaterThan(0);
            expect(history[0]).toHaveProperty('timestamp');
            expect(history[0]).toHaveProperty('concurrency');
            expect(history[0]).toHaveProperty('queueLength');
        });
    });
    
    describe('Graceful Shutdown', () => {
        test('should shutdown gracefully with active permits', async () => {
            const permits = [];
            for (let i = 0; i < 10; i++) {
                permits.push(await manager.acquire(`shutdown-${i}`));
            }
            
            const shutdownPromise = manager.shutdown({ timeout: 1000 });
            
            // Release permits during shutdown
            setTimeout(async () => {
                for (const permit of permits) {
                    await manager.release(permit.id);
                }
            }, 100);
            
            await shutdownPromise;
            
            expect(manager.getCurrentConcurrency()).toBe(0);
            expect(manager.isShutdown()).toBe(true);
            
            // Should not accept new requests
            await expect(
                manager.acquire('post-shutdown')
            ).rejects.toThrow('Manager is shut down');
        });
        
        test('should force shutdown after timeout', async () => {
            const permits = [];
            for (let i = 0; i < 5; i++) {
                permits.push(await manager.acquire(`force-shutdown-${i}`));
            }
            
            // Don't release permits
            await manager.shutdown({ timeout: 100, force: true });
            
            expect(manager.isShutdown()).toBe(true);
            expect(manager.getCurrentConcurrency()).toBe(0);
        });
    });
});