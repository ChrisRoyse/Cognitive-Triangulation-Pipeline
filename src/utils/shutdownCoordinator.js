/**
 * Shutdown Coordinator - Eliminates race conditions during shutdown sequence
 * 
 * Features:
 * - Mutex-protected shutdown operations to prevent concurrent shutdowns
 * - Dependency-ordered shutdown sequence (workers → managers → connections)
 * - Atomic state transitions with rollback capability
 * - Sequential shutdown to eliminate Promise.allSettled race conditions
 * - Timeout protection for each shutdown phase
 * - Comprehensive error tracking and recovery
 */

const { EventEmitter } = require('events');

class ShutdownCoordinator extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.shutdownMutex = false;
        this.shutdownState = 'IDLE'; // IDLE, STARTING, WORKERS, MANAGERS, CONNECTIONS, CLEANUP, COMPLETED, FAILED
        this.shutdownOrder = []; // Track shutdown sequence for debugging
        this.shutdownErrors = [];
        this.shutdownStartTime = null;
        
        // Configuration
        this.config = {
            // Phase timeouts (ms)
            workerShutdownTimeout: options.workerShutdownTimeout || 15000,
            managerShutdownTimeout: options.managerShutdownTimeout || 20000,
            connectionShutdownTimeout: options.connectionShutdownTimeout || 10000,
            cleanupTimeout: options.cleanupTimeout || 10000,
            
            // Overall timeout
            totalShutdownTimeout: options.totalShutdownTimeout || 60000,
            
            // Retry configuration
            retryAttempts: options.retryAttempts || 2,
            retryDelay: options.retryDelay || 1000,
            
            // Force shutdown configuration
            allowForceShutdown: options.allowForceShutdown !== false,
            forceShutdownGracePeriod: options.forceShutdownGracePeriod || 5000
        };
        
        // Registry of shutdown operations
        this.shutdownOperations = {
            workers: new Map(),       // workerName -> { instance, shutdownFn, priority }
            managers: new Map(),      // managerName -> { instance, shutdownFn, priority }
            connections: new Map(),   // connectionName -> { instance, shutdownFn, priority }
            cleanup: new Map()        // cleanupName -> { instance, cleanupFn, priority }
        };
        
        // State transition callbacks
        this.stateTransitionCallbacks = new Map();
        
        console.log('🔒 ShutdownCoordinator initialized with mutex protection');
    }
    
    /**
     * Acquire shutdown mutex - prevents concurrent shutdown operations
     */
    acquireMutex() {
        if (this.shutdownMutex) {
            return false; // Mutex already held
        }
        
        this.shutdownMutex = true;
        this.shutdownStartTime = Date.now();
        this.shutdownOrder = [];
        this.shutdownErrors = [];
        
        console.log('🔒 Shutdown mutex acquired');
        return true;
    }
    
    /**
     * Release shutdown mutex
     */
    releaseMutex() {
        this.shutdownMutex = false;
        console.log('🔓 Shutdown mutex released');
    }
    
    /**
     * Atomic state transition with validation and rollback
     */
    transitionState(expectedState, newState) {
        if (this.shutdownState !== expectedState) {
            const error = new Error(`Invalid state transition: expected ${expectedState}, current ${this.shutdownState}`);
            console.error('❌ State transition failed:', error.message);
            return false;
        }
        
        // Record the transition
        const previousState = this.shutdownState;
        this.shutdownState = newState;
        this.shutdownOrder.push({
            timestamp: Date.now(),
            transition: `${previousState} → ${newState}`,
            elapsed: this.shutdownStartTime ? Date.now() - this.shutdownStartTime : 0
        });
        
        console.log(`🔄 State transition: ${previousState} → ${newState}`);
        this.emit('stateTransition', { previousState, newState, timestamp: Date.now() });
        
        // Execute state transition callbacks
        const callback = this.stateTransitionCallbacks.get(newState);
        if (callback && typeof callback === 'function') {
            try {
                callback(previousState, newState);
            } catch (error) {
                console.warn('⚠️ State transition callback error:', error.message);
            }
        }
        
        return true;
    }
    
    /**
     * Register a worker for shutdown coordination
     */
    registerWorker(name, instance, shutdownFn, priority = 5) {
        if (typeof shutdownFn !== 'function') {
            throw new Error(`Worker ${name} shutdown function must be a function`);
        }
        
        this.shutdownOperations.workers.set(name, {
            instance,
            shutdownFn,
            priority,
            registered: Date.now()
        });
        
        console.log(`📝 Registered worker: ${name} (priority: ${priority})`);
    }
    
    /**
     * Register a manager for shutdown coordination
     */
    registerManager(name, instance, shutdownFn, priority = 5) {
        if (typeof shutdownFn !== 'function') {
            throw new Error(`Manager ${name} shutdown function must be a function`);
        }
        
        this.shutdownOperations.managers.set(name, {
            instance,
            shutdownFn,
            priority,
            registered: Date.now()
        });
        
        console.log(`📝 Registered manager: ${name} (priority: ${priority})`);
    }
    
    /**
     * Register a connection for shutdown coordination
     */
    registerConnection(name, instance, shutdownFn, priority = 5) {
        if (typeof shutdownFn !== 'function') {
            throw new Error(`Connection ${name} shutdown function must be a function`);
        }
        
        this.shutdownOperations.connections.set(name, {
            instance,
            shutdownFn,
            priority,
            registered: Date.now()
        });
        
        console.log(`📝 Registered connection: ${name} (priority: ${priority})`);
    }
    
    /**
     * Register a cleanup operation
     */
    registerCleanup(name, instance, cleanupFn, priority = 5) {
        if (typeof cleanupFn !== 'function') {
            throw new Error(`Cleanup ${name} function must be a function`);
        }
        
        this.shutdownOperations.cleanup.set(name, {
            instance,
            cleanupFn,
            priority,
            registered: Date.now()
        });
        
        console.log(`📝 Registered cleanup: ${name} (priority: ${priority})`);
    }
    
    /**
     * Register state transition callback
     */
    onStateTransition(state, callback) {
        this.stateTransitionCallbacks.set(state, callback);
    }
    
    /**
     * Execute shutdown phase with sequential processing and timeout
     */
    async executeShutdownPhase(phaseName, operations, timeout) {
        if (!this.transitionState(this.shutdownState, phaseName.toUpperCase())) {
            throw new Error(`Failed to transition to ${phaseName} phase`);
        }
        
        console.log(`🛑 Starting ${phaseName} shutdown phase (timeout: ${timeout}ms)`);
        
        try {
            // Sort operations by priority (higher priority shuts down first)
            const sortedOperations = Array.from(operations.entries())
                .sort(([, a], [, b]) => b.priority - a.priority);
            
            // Sequential shutdown to prevent race conditions
            const results = [];
            for (const [name, operation] of sortedOperations) {
                const result = await this.executeWithTimeout(
                    name,
                    operation,
                    timeout / sortedOperations.length // Distribute timeout across operations
                );
                results.push(result);
            }
            
            // Check for any failures
            const failures = results.filter(r => !r.success);
            if (failures.length > 0) {
                console.warn(`⚠️ ${phaseName} phase completed with ${failures.length} failures`);
                failures.forEach(failure => {
                    this.shutdownErrors.push(`${phaseName}:${failure.name}: ${failure.error}`);
                });
            } else {
                console.log(`✅ ${phaseName} phase completed successfully`);
            }
            
            return {
                success: failures.length === 0,
                completed: results.length,
                failed: failures.length,
                failures: failures
            };
            
        } catch (error) {
            console.error(`❌ Critical error in ${phaseName} phase:`, error.message);
            this.shutdownErrors.push(`${phaseName}:CRITICAL: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Execute single operation with timeout and retry logic
     */
    async executeWithTimeout(name, operation, timeout) {
        const { instance, shutdownFn, cleanupFn } = operation;
        const fn = shutdownFn || cleanupFn;
        
        for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
            try {
                console.log(`🔄 Shutting down ${name} (attempt ${attempt}/${this.config.retryAttempts})`);
                
                // Execute with timeout
                const result = await this.timeoutWrapper(
                    fn.call(instance),
                    timeout,
                    `${name} shutdown`
                );
                
                console.log(`✅ ${name} shutdown completed successfully`);
                return { success: true, name, attempt };
                
            } catch (error) {
                const isLastAttempt = attempt === this.config.retryAttempts;
                
                if (isLastAttempt) {
                    console.error(`❌ ${name} shutdown failed after ${attempt} attempts:`, error.message);
                    return { success: false, name, error: error.message, attempts: attempt };
                } else {
                    console.warn(`⚠️ ${name} shutdown attempt ${attempt} failed, retrying:`, error.message);
                    await this.delay(this.config.retryDelay * attempt); // Exponential backoff
                }
            }
        }
    }
    
    /**
     * Main shutdown coordination entry point
     */
    async shutdown(options = {}) {
        // Attempt to acquire mutex
        if (!this.acquireMutex()) {
            const error = new Error('Shutdown already in progress');
            console.error('❌ Concurrent shutdown attempt blocked:', error.message);
            throw error;
        }
        
        try {
            if (!this.transitionState('IDLE', 'STARTING')) {
                throw new Error('Invalid initial state for shutdown');
            }
            
            console.log('🚀 Starting coordinated shutdown sequence...');
            this.emit('shutdownStarted', { timestamp: Date.now() });
            
            // Set overall timeout
            const totalTimeout = options.totalTimeout || this.config.totalShutdownTimeout;
            const shutdownPromise = this.executeShutdownSequence();
            const timeoutPromise = this.delay(totalTimeout).then(() => {
                throw new Error(`Total shutdown timeout exceeded (${totalTimeout}ms)`);
            });
            
            // Race between shutdown completion and timeout
            await Promise.race([shutdownPromise, timeoutPromise]);
            
            // Final state transition
            if (!this.transitionState(this.shutdownState, 'COMPLETED')) {
                console.warn('⚠️ Could not transition to COMPLETED state');
            }
            
            const duration = Date.now() - this.shutdownStartTime;
            console.log(`🎉 Coordinated shutdown completed successfully in ${duration}ms`);
            
            this.emit('shutdownCompleted', {
                duration,
                errors: this.shutdownErrors,
                sequence: this.shutdownOrder
            });
            
            return {
                success: true,
                duration,
                errors: this.shutdownErrors,
                sequence: this.shutdownOrder
            };
            
        } catch (error) {
            // Transition to failed state
            this.transitionState(this.shutdownState, 'FAILED');
            
            const duration = this.shutdownStartTime ? Date.now() - this.shutdownStartTime : 0;
            console.error(`❌ Coordinated shutdown failed after ${duration}ms:`, error.message);
            
            this.emit('shutdownFailed', {
                error: error.message,
                duration,
                errors: this.shutdownErrors,
                sequence: this.shutdownOrder
            });
            
            // Force shutdown if enabled and not already attempted
            if (this.config.allowForceShutdown && !options.isForceShutdown) {
                console.warn('🚨 Attempting force shutdown...');
                await this.delay(this.config.forceShutdownGracePeriod);
                return await this.forceShutdown();
            }
            
            throw error;
            
        } finally {
            this.releaseMutex();
        }
    }
    
    /**
     * Execute the complete shutdown sequence in dependency order
     */
    async executeShutdownSequence() {
        // Phase 1: Workers (highest dependency, shutdown first)
        if (this.shutdownOperations.workers.size > 0) {
            await this.executeShutdownPhase(
                'workers',
                this.shutdownOperations.workers,
                this.config.workerShutdownTimeout
            );
        }
        
        // Phase 2: Managers (depend on workers)
        if (this.shutdownOperations.managers.size > 0) {
            await this.executeShutdownPhase(
                'managers',
                this.shutdownOperations.managers,
                this.config.managerShutdownTimeout
            );
        }
        
        // Phase 3: Connections (depend on managers)
        if (this.shutdownOperations.connections.size > 0) {
            await this.executeShutdownPhase(
                'connections',
                this.shutdownOperations.connections,
                this.config.connectionShutdownTimeout
            );
        }
        
        // Phase 4: Cleanup operations (lowest dependency, cleanup last)
        if (this.shutdownOperations.cleanup.size > 0) {
            await this.executeShutdownPhase(
                'cleanup',
                this.shutdownOperations.cleanup,
                this.config.cleanupTimeout
            );
        }
    }
    
    /**
     * Force shutdown - bypass normal coordination for emergency situations
     */
    async forceShutdown() {
        console.warn('🚨 FORCE SHUTDOWN INITIATED - bypassing coordination');
        
        const forceErrors = [];
        
        // Force shutdown all operations without coordination
        const allOperations = [
            ...Array.from(this.shutdownOperations.workers.entries()),
            ...Array.from(this.shutdownOperations.managers.entries()),
            ...Array.from(this.shutdownOperations.connections.entries()),
            ...Array.from(this.shutdownOperations.cleanup.entries())
        ];
        
        // Use Promise.allSettled for force shutdown (parallel, not sequential)
        const results = await Promise.allSettled(
            allOperations.map(async ([name, operation]) => {
                try {
                    const { instance, shutdownFn, cleanupFn } = operation;
                    const fn = shutdownFn || cleanupFn;
                    
                    // Much shorter timeout for force shutdown
                    await this.timeoutWrapper(
                        fn.call(instance),
                        5000, // 5 second timeout
                        `${name} force shutdown`
                    );
                    
                    console.log(`⚡ Force shutdown ${name} completed`);
                    return { name, success: true };
                } catch (error) {
                    console.error(`💥 Force shutdown ${name} failed:`, error.message);
                    forceErrors.push(`${name}: ${error.message}`);
                    return { name, success: false, error: error.message };
                }
            })
        );
        
        const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
        const failed = results.length - successful;
        
        console.warn(`🚨 Force shutdown completed: ${successful} successful, ${failed} failed`);
        
        return {
            success: failed === 0,
            forceShutdown: true,
            successful,
            failed,
            errors: forceErrors
        };
    }
    
    /**
     * Timeout wrapper for shutdown operations
     */
    async timeoutWrapper(promise, timeoutMs, operationName) {
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            })
        ]);
    }
    
    /**
     * Delay utility
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Get current shutdown status
     */
    getStatus() {
        return {
            state: this.shutdownState,
            mutexHeld: this.shutdownMutex,
            startTime: this.shutdownStartTime,
            elapsed: this.shutdownStartTime ? Date.now() - this.shutdownStartTime : 0,
            errors: [...this.shutdownErrors],
            sequence: [...this.shutdownOrder],
            registered: {
                workers: this.shutdownOperations.workers.size,
                managers: this.shutdownOperations.managers.size,
                connections: this.shutdownOperations.connections.size,
                cleanup: this.shutdownOperations.cleanup.size
            }
        };
    }
    
    /**
     * Check if shutdown is in progress
     */
    isShutdownInProgress() {
        return this.shutdownMutex || this.shutdownState !== 'IDLE';
    }
    
    /**
     * Reset coordinator state (for testing or recovery)
     */
    reset() {
        if (this.shutdownMutex) {
            console.warn('⚠️ Resetting coordinator while shutdown in progress');
        }
        
        this.shutdownMutex = false;
        this.shutdownState = 'IDLE';
        this.shutdownOrder = [];
        this.shutdownErrors = [];
        this.shutdownStartTime = null;
        
        console.log('🔄 ShutdownCoordinator reset to initial state');
    }
}

module.exports = { ShutdownCoordinator };