class AccuracyCalculator {
    calculateMetrics(comparisonResults) {
        const tp = comparisonResults.truePositives.length;
        const fp = comparisonResults.falsePositives.length;
        const fn = comparisonResults.falseNegatives.length;
        const tn = 0; // True negatives not applicable for relationship detection
        
        // Calculate basic metrics
        const precision = tp / (tp + fp) || 0;
        const recall = tp / (tp + fn) || 0;
        const f1Score = 2 * (precision * recall) / (precision + recall) || 0;
        const accuracy = tp / (tp + fp + fn) || 0;
        
        // Calculate additional metrics
        const metrics = {
            precision,
            recall,
            f1Score,
            accuracy,
            truePositives: tp,
            falsePositives: fp,
            falseNegatives: fn,
            total: tp + fp + fn,
            
            // Extended metrics
            specificity: tn / (tn + fp) || 0,
            sensitivity: recall, // Same as recall
            matthewsCorrelation: this.calculateMCC(tp, tn, fp, fn),
            
            // Confidence-based metrics
            confidenceMetrics: this.calculateConfidenceMetrics(comparisonResults),
            
            // Category-based breakdown
            categoryMetrics: this.calculateCategoryMetrics(comparisonResults),
            
            // Statistical significance
            significance: this.calculateStatisticalSignificance(tp, fp, fn)
        };
        
        return metrics;
    }
    
    calculateMCC(tp, tn, fp, fn) {
        // Matthews Correlation Coefficient
        const numerator = (tp * tn) - (fp * fn);
        const denominator = Math.sqrt(
            (tp + fp) * (tp + fn) * (tn + fp) * (tn + fn)
        );
        
        return denominator === 0 ? 0 : numerator / denominator;
    }
    
    calculateConfidenceMetrics(comparisonResults) {
        if (comparisonResults.truePositives.length === 0) {
            return {
                avgConfidence: 0,
                minConfidence: 0,
                maxConfidence: 0,
                confidenceDistribution: {}
            };
        }
        
        const confidences = comparisonResults.truePositives.map(tp => tp.confidence || 1);
        
        const distribution = this.getConfidenceDistribution(confidences);
        
        return {
            avgConfidence: confidences.reduce((sum, c) => sum + c, 0) / confidences.length,
            minConfidence: Math.min(...confidences),
            maxConfidence: Math.max(...confidences),
            confidenceDistribution: distribution,
            correlationWithAccuracy: this.calculateConfidenceAccuracyCorrelation(comparisonResults)
        };
    }
    
    getConfidenceDistribution(confidences) {
        const buckets = {
            'very_high': 0,  // >= 0.9
            'high': 0,       // >= 0.8
            'medium': 0,     // >= 0.7
            'low': 0,        // >= 0.6
            'very_low': 0    // < 0.6
        };
        
        confidences.forEach(conf => {
            if (conf >= 0.9) buckets.very_high++;
            else if (conf >= 0.8) buckets.high++;
            else if (conf >= 0.7) buckets.medium++;
            else if (conf >= 0.6) buckets.low++;
            else buckets.very_low++;
        });
        
        // Convert to percentages
        const total = confidences.length;
        Object.keys(buckets).forEach(key => {
            buckets[key] = {
                count: buckets[key],
                percentage: (buckets[key] / total) * 100
            };
        });
        
        return buckets;
    }
    
    calculateConfidenceAccuracyCorrelation(comparisonResults) {
        // Calculate Pearson correlation between confidence and correctness
        const dataPoints = [];
        
        // True positives (correct = 1)
        comparisonResults.truePositives.forEach(tp => {
            dataPoints.push({
                confidence: tp.confidence || 1,
                correct: 1
            });
        });
        
        // False positives (correct = 0)
        comparisonResults.falsePositives.forEach(fp => {
            dataPoints.push({
                confidence: fp.confidence_score || fp.confidence || 0.5,
                correct: 0
            });
        });
        
        if (dataPoints.length < 2) return 0;
        
        return this.pearsonCorrelation(
            dataPoints.map(d => d.confidence),
            dataPoints.map(d => d.correct)
        );
    }
    
    pearsonCorrelation(x, y) {
        const n = x.length;
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((total, xi, i) => total + xi * y[i], 0);
        const sumX2 = x.reduce((total, xi) => total + xi * xi, 0);
        const sumY2 = y.reduce((total, yi) => total + yi * yi, 0);
        
        const numerator = n * sumXY - sumX * sumY;
        const denominator = Math.sqrt(
            (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
        );
        
        return denominator === 0 ? 0 : numerator / denominator;
    }
    
    calculateCategoryMetrics(comparisonResults) {
        const categories = {};
        
        // Group by category from ground truth
        comparisonResults.truePositives.forEach(tp => {
            const category = tp.groundTruth.category || 'unknown';
            if (!categories[category]) {
                categories[category] = { tp: 0, fp: 0, fn: 0 };
            }
            categories[category].tp++;
        });
        
        comparisonResults.falseNegatives.forEach(fn => {
            const category = fn.category || 'unknown';
            if (!categories[category]) {
                categories[category] = { tp: 0, fp: 0, fn: 0 };
            }
            categories[category].fn++;
        });
        
        // Calculate metrics per category
        const categoryMetrics = {};
        Object.entries(categories).forEach(([category, counts]) => {
            const precision = counts.tp / (counts.tp + counts.fp) || 0;
            const recall = counts.tp / (counts.tp + counts.fn) || 0;
            const f1 = 2 * (precision * recall) / (precision + recall) || 0;
            
            categoryMetrics[category] = {
                precision,
                recall,
                f1Score: f1,
                support: counts.tp + counts.fn, // Total ground truth for this category
                detected: counts.tp + counts.fp  // Total detected for this category
            };
        });
        
        return categoryMetrics;
    }
    
    calculateStatisticalSignificance(tp, fp, fn) {
        const total = tp + fp + fn;
        if (total < 30) {
            return {
                significant: false,
                pValue: null,
                confidenceInterval: null,
                message: 'Sample size too small for statistical significance'
            };
        }
        
        // Calculate confidence interval for accuracy
        const accuracy = tp / total;
        const standardError = Math.sqrt((accuracy * (1 - accuracy)) / total);
        const zScore = 1.96; // 95% confidence level
        
        const confidenceInterval = {
            lower: Math.max(0, accuracy - zScore * standardError),
            upper: Math.min(1, accuracy + zScore * standardError)
        };
        
        // Simple binomial test against null hypothesis (random guessing = 0.5)
        const expectedCorrect = total * 0.5;
        const zStat = (tp - expectedCorrect) / Math.sqrt(total * 0.5 * 0.5);
        const pValue = 2 * (1 - this.normalCDF(Math.abs(zStat)));
        
        return {
            significant: pValue < 0.05,
            pValue,
            confidenceInterval,
            zStatistic: zStat,
            message: pValue < 0.05 
                ? 'Results are statistically significant' 
                : 'Results are not statistically significant'
        };
    }
    
    normalCDF(z) {
        // Approximation of the cumulative distribution function for standard normal
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const p = 0.3275911;
        
        const sign = z < 0 ? -1 : 1;
        z = Math.abs(z) / Math.sqrt(2);
        
        const t = 1 / (1 + p * z);
        const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
        
        return 0.5 * (1 + sign * y);
    }
    
    generateDetailedReport(metrics, comparisonResults) {
        return {
            summary: {
                accuracy: `${(metrics.accuracy * 100).toFixed(2)}%`,
                precision: `${(metrics.precision * 100).toFixed(2)}%`,
                recall: `${(metrics.recall * 100).toFixed(2)}%`,
                f1Score: `${(metrics.f1Score * 100).toFixed(2)}%`
            },
            counts: {
                truePositives: metrics.truePositives,
                falsePositives: metrics.falsePositives,
                falseNegatives: metrics.falseNegatives,
                total: metrics.total
            },
            confidence: metrics.confidenceMetrics,
            byCategory: metrics.categoryMetrics,
            statisticalSignificance: metrics.significance,
            recommendations: this.generateRecommendations(metrics)
        };
    }
    
    generateRecommendations(metrics) {
        const recommendations = [];
        
        if (metrics.precision < 0.9) {
            recommendations.push({
                type: 'precision',
                priority: 'high',
                message: 'Precision below 90%. Consider stricter validation rules to reduce false positives.'
            });
        }
        
        if (metrics.recall < 0.9) {
            recommendations.push({
                type: 'recall',
                priority: 'high',
                message: 'Recall below 90%. Review detection logic to capture more true relationships.'
            });
        }
        
        if (metrics.confidenceMetrics.correlationWithAccuracy < 0.5) {
            recommendations.push({
                type: 'confidence',
                priority: 'medium',
                message: 'Low correlation between confidence and accuracy. Confidence scoring needs calibration.'
            });
        }
        
        // Check category-specific issues
        Object.entries(metrics.categoryMetrics).forEach(([category, catMetrics]) => {
            if (catMetrics.f1Score < 0.8) {
                recommendations.push({
                    type: 'category',
                    priority: 'medium',
                    category,
                    message: `Poor performance on ${category} relationships (F1: ${(catMetrics.f1Score * 100).toFixed(1)}%)`
                });
            }
        });
        
        return recommendations;
    }
}

module.exports = { AccuracyCalculator };