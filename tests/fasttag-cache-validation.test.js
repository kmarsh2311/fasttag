'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const fasttagSource = fs.readFileSync(path.join(repositoryRoot, 'fasttag.js'), 'utf8');

// Ensure FastTag entities module is loaded
global.FastTag = {};
require(path.join(repositoryRoot, 'fasttag-entities.js'));
const { ENTITY_CONFIG } = global.FastTag.entities;

// --- Test 1: Ensure unsafe "< 5" heuristic is completely removed from fasttag.js ---
assert.ok(
    !fasttagSource.includes('item.data.length < 5'),
    'fasttag.js must NOT contain the unsafe "item.data.length < 5" cache-purge heuristic'
);
assert.ok(
    !fasttagSource.includes('length < 5'),
    'fasttag.js must NOT contain any arbitrary length < 5 threshold'
);

// --- Test 2: Ensure ENTITY_CONFIG provides countQuery and extractCount for all entity types ---
const expectedTypes = ['tags', 'performers', 'studios', 'groups', 'galleries'];
for (const type of expectedTypes) {
    const config = ENTITY_CONFIG[type];
    assert.ok(config, `ENTITY_CONFIG must have entry for ${type}`);
    assert.ok(config.countQuery, `${type} must have countQuery`);
    assert.ok(config.countQuery.includes('per_page: 0'), `${type} countQuery must use per_page: 0`);
    assert.equal(typeof config.extractCount, 'function', `${type} must have extractCount function`);
}

// Verify extractCount for each type
assert.equal(ENTITY_CONFIG.tags.extractCount({ findTags: { count: 3 } }), 3);
assert.equal(ENTITY_CONFIG.tags.extractCount({ findTags: { count: 0 } }), 0);
assert.equal(ENTITY_CONFIG.performers.extractCount({ findPerformers: { count: 1 } }), 1);
assert.equal(ENTITY_CONFIG.performers.extractCount({ findPerformers: { count: 1883 } }), 1883);
assert.equal(ENTITY_CONFIG.studios.extractCount({ findStudios: { count: 4 } }), 4);
assert.equal(ENTITY_CONFIG.galleries.extractCount({ findGalleries: { count: 0 } }), 0);
assert.equal(ENTITY_CONFIG.groups.extractCount({ findGroups: { count: 2 } }), 2);
assert.equal(ENTITY_CONFIG.groups.extractCount({ findMovies: { count: 2 } }), 2);

// --- Test 3: Cache Consistency Validator Unit Tests ---

function createCacheManager(options = {}) {
    const fetchGQL = options.fetchGQL || (async () => ({ data: {} }));
    const fetchEntityListSafely = options.fetchEntityListSafely || (async () => []);
    const CACHE_TTL = 12 * 60 * 60 * 1000;
    const COUNT_VERIFY_INTERVAL = options.countVerifyInterval || 60 * 1000;

    const cacheStore = {
        tags: { data: null, timestamp: 0, _countVerifiedAt: 0 },
        performers: { data: null, timestamp: 0, _countVerifiedAt: 0 },
        galleries: { data: null, timestamp: 0, _countVerifiedAt: 0 },
        studios: { data: null, timestamp: 0, _countVerifiedAt: 0 },
        groups: { data: null, timestamp: 0, _countVerifiedAt: 0 }
    };

    function getCachedOrNull(type) {
        const item = cacheStore[type];
        if (item && item.data && Array.isArray(item.data)) {
            const age = Date.now() - item.timestamp;
            if (age < CACHE_TTL) {
                return item.data;
            }
        }
        return null;
    }

    function setCache(type, data) {
        const now = Date.now();
        cacheStore[type] = { data, timestamp: now, _countVerifiedAt: now };
    }

    function invalidateCache(type) {
        if (type && cacheStore[type]) {
            cacheStore[type] = { data: null, timestamp: 0, _countVerifiedAt: 0 };
        }
    }

    async function fetchEntityCountSafely(type) {
        const config = ENTITY_CONFIG[type];
        if (!config || !config.countQuery) return null;
        try {
            const res = await fetchGQL(config.countQuery);
            let count = config.extractCount?.(res?.data);
            if (typeof count === 'number' && !isNaN(count)) {
                return count;
            }
            if (res?.errors && res.errors.length > 0 && config.fallbackCountQuery) {
                const fallbackRes = await fetchGQL(config.fallbackCountQuery);
                count = config.extractCount?.(fallbackRes?.data);
                if (typeof count === 'number' && !isNaN(count)) {
                    return count;
                }
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    async function validateCacheConsistency(type) {
        const item = cacheStore[type];
        if (!item || !Array.isArray(item.data)) {
            return false;
        }

        if (item._countVerifiedAt && (Date.now() - item._countVerifiedAt < COUNT_VERIFY_INTERVAL)) {
            return true;
        }

        if (item._validatingPromise) {
            return item._validatingPromise;
        }

        item._validatingPromise = (async () => {
            try {
                const remoteCount = await fetchEntityCountSafely(type);
                if (typeof remoteCount !== 'number' || isNaN(remoteCount)) {
                    // Network / GraphQL error: fail open, preserve existing cache
                    return true;
                }

                const cachedCount = item.data ? item.data.length : 0;
                if (cachedCount !== remoteCount) {
                    invalidateCache(type);
                    return false;
                }

                item._countVerifiedAt = Date.now();
                return true;
            } catch (e) {
                return true;
            } finally {
                if (cacheStore[type]) {
                    delete cacheStore[type]._validatingPromise;
                }
            }
        })();

        return item._validatingPromise;
    }

    async function ensureCachedEntityList(type) {
        let cached = getCachedOrNull(type);
        if (cached) {
            const isConsistent = await validateCacheConsistency(type);
            if (!isConsistent) {
                cached = null;
            }
        }
        if (!cached) {
            cached = await fetchEntityListSafely(type);
            if (cached && Array.isArray(cached) && cached.length > 0) {
                setCache(type, cached);
            }
        }
        return cached || null;
    }

    return {
        cacheStore,
        getCachedOrNull,
        setCache,
        invalidateCache,
        fetchEntityCountSafely,
        validateCacheConsistency,
        ensureCachedEntityList
    };
}

async function runTests() {
    // Subtest A: Legitimate tiny library with 1 performer (should NOT be purged)
    {
        let countQueryCalls = 0;
        let fullFetchCalls = 0;
        const mgr = createCacheManager({
            fetchGQL: async (q) => {
                countQueryCalls++;
                return { data: { findPerformers: { count: 1 } } };
            },
            fetchEntityListSafely: async () => {
                fullFetchCalls++;
                return [{ id: '1', name: 'Solo Performer' }];
            }
        });

        // Prewarm cache with 1 legitimate performer (simulate IDB prewarm)
        mgr.cacheStore.performers = {
            data: [{ id: '1', name: 'Solo Performer' }],
            timestamp: Date.now() - 1000,
            _countVerifiedAt: 0
        };

        const result = await mgr.ensureCachedEntityList('performers');
        assert.equal(result.length, 1, 'Legitimate 1-item library must be preserved');
        assert.equal(result[0].name, 'Solo Performer');
        assert.equal(fullFetchCalls, 0, 'Full reload must NOT be triggered when count matches');
        assert.equal(countQueryCalls, 1, 'Lightweight count query must be used for validation');
        assert.ok(mgr.cacheStore.performers._countVerifiedAt > 0, '_countVerifiedAt must be recorded');
    }

    // Subtest B: Legitimate tiny library with 2-4 tags (should NOT be purged)
    {
        for (const count of [2, 3, 4]) {
            let fullFetchCalls = 0;
            const mockTags = Array.from({ length: count }, (_, i) => ({ id: String(i + 1), name: `Tag ${i + 1}` }));
            const mgr = createCacheManager({
                fetchGQL: async () => ({ data: { findTags: { count } } }),
                fetchEntityListSafely: async () => {
                    fullFetchCalls++;
                    return mockTags;
                }
            });

            mgr.cacheStore.tags = {
                data: mockTags,
                timestamp: Date.now() - 5000,
                _countVerifiedAt: 0
            };

            const result = await mgr.ensureCachedEntityList('tags');
            assert.equal(result.length, count, `Legitimate ${count}-item tag library must NOT be purged`);
            assert.equal(fullFetchCalls, 0, `No full reload for legitimate ${count}-item tag library`);
            assert.equal(mgr.getCachedOrNull('tags').length, count, 'Cache must remain valid in getCachedOrNull');
        }
    }

    // Subtest C: Poisoned cache where cached count clearly disagrees with Stash
    {
        let countQueryCalls = 0;
        let fullFetchCalls = 0;
        const fresh1883Performers = Array.from({ length: 1883 }, (_, i) => ({ id: String(i + 1), name: `Performer ${i + 1}` }));

        const mgr = createCacheManager({
            fetchGQL: async (q) => {
                countQueryCalls++;
                return { data: { findPerformers: { count: 1883 } } };
            },
            fetchEntityListSafely: async () => {
                fullFetchCalls++;
                return fresh1883Performers;
            }
        });

        // Poisoned cache: only has 2 performers (e.g. from prior bug or partial write)
        mgr.cacheStore.performers = {
            data: [{ id: '101', name: 'Jose' }, { id: '102', name: 'Maria' }],
            timestamp: Date.now() - 10000,
            _countVerifiedAt: 0
        };

        const result = await mgr.ensureCachedEntityList('performers');
        assert.equal(countQueryCalls, 1, 'Count query must be called to verify consistency');
        assert.equal(fullFetchCalls, 1, 'Full fetch must be triggered when count mismatch is detected');
        assert.equal(result.length, 1883, 'Full fresh dataset must be returned after resolving poisoned cache');
        assert.equal(mgr.getCachedOrNull('performers').length, 1883, 'CacheStore must now hold the 1883 items');
    }

    // Subtest D: External Stash change (e.g. user created tag in Stash outside FastTag)
    {
        let fullFetchCalls = 0;
        const mgr = createCacheManager({
            fetchGQL: async () => ({ data: { findTags: { count: 11 } } }),
            fetchEntityListSafely: async () => {
                fullFetchCalls++;
                return Array.from({ length: 11 }, (_, i) => ({ id: String(i + 1), name: `Tag ${i + 1}` }));
            }
        });

        // Cache currently has 10 tags
        mgr.cacheStore.tags = {
            data: Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), name: `Tag ${i + 1}` })),
            timestamp: Date.now() - 2000,
            _countVerifiedAt: 0
        };

        const result = await mgr.ensureCachedEntityList('tags');
        assert.equal(fullFetchCalls, 1, 'Disagreement (10 cached vs 11 in Stash) must invalidate and reload');
        assert.equal(result.length, 11);
    }

    // Subtest E: Throttling preserves 0ms instant response during rapid popup opens
    {
        let countQueryCalls = 0;
        const mgr = createCacheManager({
            fetchGQL: async () => {
                countQueryCalls++;
                return { data: { findStudios: { count: 50 } } };
            }
        });

        // Cache recently verified (10 seconds ago)
        mgr.cacheStore.studios = {
            data: Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1), name: `Studio ${i + 1}` })),
            timestamp: Date.now() - 10000,
            _countVerifiedAt: Date.now() - 10000
        };

        // Open popup 5 times rapidly
        for (let i = 0; i < 5; i++) {
            const res = await mgr.ensureCachedEntityList('studios');
            assert.equal(res.length, 50);
        }
        assert.equal(countQueryCalls, 0, 'No count queries should be issued within COUNT_VERIFY_INTERVAL');
    }

    // Subtest F: Resilience / Fail-Open on GraphQL/Network error
    {
        const mgr = createCacheManager({
            fetchGQL: async () => {
                throw new Error('Network connection offline');
            }
        });

        // Valid cached tags
        mgr.cacheStore.tags = {
            data: [{ id: '1', name: 'Offline Tag' }],
            timestamp: Date.now() - 60000,
            _countVerifiedAt: 0
        };

        const result = await mgr.ensureCachedEntityList('tags');
        assert.equal(result.length, 1, 'Offline/error must NOT purge existing cache (fail-open resilience)');
        assert.equal(result[0].name, 'Offline Tag');
    }

    console.log('fasttag-cache-validation tests passed');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
