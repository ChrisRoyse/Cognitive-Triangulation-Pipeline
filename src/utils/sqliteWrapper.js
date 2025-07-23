const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

class Database {
    constructor(filename, options = {}) {
        this.filename = filename;
        this.db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
        this.closed = false;
        
        // Promisify common methods for internal use
        this._run = promisify(this.db.run.bind(this.db));
        this._get = promisify(this.db.get.bind(this.db));
        this._all = promisify(this.db.all.bind(this.db));
        this._exec = promisify(this.db.exec.bind(this.db));
    }

    prepare(sql) {
        const self = this;
        const stmt = this.db.prepare(sql);
        
        // Create a synchronous-like wrapper
        return {
            run(...params) {
                return new Promise((resolve, reject) => {
                    stmt.run(...params, function(err) {
                        if (err) reject(err);
                        else resolve({ changes: this.changes, lastInsertRowid: this.lastID });
                    });
                }).then(result => {
                    return result;
                });
            },
            
            get(...params) {
                return new Promise((resolve, reject) => {
                    stmt.get(...params, (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });
            },
            
            all(...params) {
                return new Promise((resolve, reject) => {
                    stmt.all(...params, (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    });
                });
            },
            
            finalize() {
                return new Promise((resolve, reject) => {
                    stmt.finalize(err => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            }
        };
    }

    exec(sql) {
        const self = this;
        // Run exec synchronously by using a blocking approach
        let error = null;
        let completed = false;
        
        this.db.exec(sql, (err) => {
            error = err;
            completed = true;
        });
        
        // Busy wait (not ideal but maintains sync API)
        while (!completed) {
            // Small delay to prevent CPU spinning
            const start = Date.now();
            while (Date.now() - start < 1) {}
        }
        
        if (error) throw error;
        return this;
    }

    pragma(sql) {
        const self = this;
        let result;
        let error = null;
        let completed = false;
        
        this.db.get(`PRAGMA ${sql}`, (err, row) => {
            error = err;
            result = row;
            completed = true;
        });
        
        while (!completed) {
            const start = Date.now();
            while (Date.now() - start < 1) {}
        }
        
        if (error) throw error;
        return result;
    }

    close() {
        if (!this.closed) {
            this.closed = true;
            return new Promise((resolve, reject) => {
                this.db.close(err => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
    }

    // Synchronous-like transaction support
    transaction(fn) {
        const self = this;
        return function(...args) {
            self.exec('BEGIN');
            try {
                const result = fn.apply(this, args);
                self.exec('COMMIT');
                return result;
            } catch (err) {
                self.exec('ROLLBACK');
                throw err;
            }
        };
    }
}

// Export a constructor function that mimics better-sqlite3
module.exports = function(filename, options) {
    return new Database(filename, options);
};

module.exports.Database = Database;