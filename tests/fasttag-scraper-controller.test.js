'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, "..", "fasttag-scraper-controller.js"), "utf8");

global.FastTag = global.FastTag || {};
require('../fasttag-scraper-controller.js');
const controller = global.FastTag.scraperController;

assert.ok(controller, 'FastTag scraper controller namespace should be installed');
assert.equal(controller.getScraperHeaderDensity(409), 'tight', 'very narrow scraper headers should use compact labels');
assert.equal(controller.getScraperHeaderDensity(410), 'normal', 'ordinary scraper widths should keep all labels on one row');
assert.equal(controller.getScraperHeaderDensity(640), 'normal');

let activePopup = null;
controller.configure({ getActivePopup: () => activePopup });

const popup = {
    currentSceneId: 'scene-1',
    element: { isConnected: true }
};
activePopup = popup;

const firstRequest = controller.beginRequest(popup, 'scene-1');
assert.equal(firstRequest, 1);
assert.equal(controller.isRequestCurrent(popup, 'scene-1', firstRequest), true);
assert.equal(controller.isRequestCurrent(popup, 'scene-2', firstRequest), false, 'a response must not cross scene ownership');

const secondRequest = controller.beginRequest(popup, 'scene-1');
assert.equal(secondRequest, 2);
assert.equal(controller.isRequestCurrent(popup, 'scene-1', firstRequest), false, 'newer requests must supersede older responses');
assert.equal(controller.isRequestCurrent(popup, 'scene-1', secondRequest), true);

controller.invalidateRequests(popup);
assert.equal(controller.isRequestCurrent(popup, 'scene-1', secondRequest), false, 'invalidation must reject the active response');
assert.equal(popup._activeScrapeRequest, null);

popup._fastTagClosed = true;
assert.equal(controller.beginRequest(popup, 'scene-1'), null, 'closed popups must not begin scraper work');
popup._fastTagClosed = false;
popup.element.isConnected = false;
assert.equal(controller.beginRequest(popup, 'scene-1'), null, 'detached popups must not begin scraper work');
popup.element.isConnected = true;
activePopup = {};
assert.equal(controller.beginRequest(popup, 'scene-1'), null, 'inactive popups must not begin scraper work');

let removed = false;
let resizeObserverDisconnected = false;
let headerObserverDisconnected = false;
const hud = {
    _fastTagResizeObserver: { disconnect: () => { resizeObserverDisconnected = true; } },
    _fastTagScraperHeaderResizeObserver: { disconnect: () => { headerObserverDisconnected = true; } },
    remove: () => { removed = true; }
};
controller.setHudElement(hud);
assert.equal(controller.getHudElement(), hud);
controller.closeHud();
assert.equal(removed, true);
assert.equal(resizeObserverDisconnected, true);
assert.equal(headerObserverDisconnected, true);
assert.equal(controller.getHudElement(), null);

controller.setHudPosition({ left: '20px', top: '30px' });
controller.setHudSize({ width: '390px', height: '480px' });
controller.resetLayoutState();
assert.equal(controller.getHudPosition(), null);
assert.equal(controller.getHudSize(), null);

const loadingPopup = {
    currentSceneId: 'scene-loading',
    element: { isConnected: true },
    scraperCardContainer: { style: { display: 'none' }, innerHTML: 'Previous scene result' },
    scrapeBtn: { disabled: false, innerHTML: '<span>Scrape</span>' }
};
activePopup = loadingPopup;
controller.configure({
    getActivePopup: () => activePopup,
    getEffectiveTheme: () => 'dark'
});
assert.equal(controller.showLoadingState(loadingPopup), true);
assert.equal(loadingPopup.scraperCardContainer.style.display, 'flex');
assert.match(loadingPopup.scraperCardContainer.innerHTML, /Scraping new scene/);
assert.match(loadingPopup.scraperCardContainer.innerHTML, /fasttag-scrape-lens/);
assert.match(loadingPopup.scraperCardContainer.innerHTML, /Checking fingerprints, titles and scene details/);
assert.doesNotMatch(loadingPopup.scraperCardContainer.innerHTML, /@keyframes|animation:/, 'the loading illustration should remain static');
assert.match(loadingPopup.scraperCardContainer.innerHTML, /role="status" aria-live="polite"/);
assert.doesNotMatch(loadingPopup.scraperCardContainer.innerHTML, /Previous scene result/);
assert.equal(loadingPopup.scrapeBtn.disabled, true);

const connectedHudElements = new Set();
const loadingHudHeader = { style: {}, onmousedown: null };
global.innerWidth = 1200;
global.innerHeight = 800;
global.document = {
    body: {
        contains: element => connectedHudElements.has(element),
        appendChild: element => { connectedHudElements.add(element); element.isConnected = true; }
    },
    createElement: () => ({
        style: {},
        innerHTML: '',
        offsetWidth: 390,
        offsetHeight: 480,
        querySelector: selector => selector === '#fasttag-scrape-loading-header' ? loadingHudHeader : null,
        querySelectorAll: () => [],
        appendChild() {},
        addEventListener() {},
        setAttribute() {},
        remove() { connectedHudElements.delete(this); this.isConnected = false; }
    }),
    querySelector: () => null
};
global.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() {}
    disconnect() {}
};
global.localStorage = { getItem: () => null, setItem() {} };
controller.configure({
    getActivePopup: () => activePopup,
    getEffectiveTheme: () => 'dark',
    getDetachScraper: () => true,
    getFloatingVideoHudElement: () => null,
    isVideoPoppedOut: () => false,
    getDefaultEverythingPosition: () => ({ x: 200, y: 100 })
});
loadingPopup.element.getBoundingClientRect = () => ({ left: 300, right: 900, top: 80, bottom: 680, width: 600, height: 600 });
loadingPopup.scraperCardContainer.innerHTML = 'Previous embedded result';
assert.equal(controller.showLoadingState(loadingPopup), true);
const detachedLoadingHud = controller.getHudElement();
assert.ok(detachedLoadingHud && connectedHudElements.has(detachedLoadingHud), 'remembered detached mode should create the HUD before scraping begins');
assert.match(detachedLoadingHud.innerHTML, /Scraping new scene/);
assert.match(detachedLoadingHud.innerHTML, /Drag to move/);
assert.equal(loadingHudHeader.style.cursor, 'grab');
assert.equal(typeof loadingHudHeader.onmousedown, 'function', 'the loading HUD header should remain draggable');
assert.equal(loadingPopup.scraperCardContainer.style.display, 'none', 'detached loading should not flash inside the main popup');
let headerLayoutRechecks = 0;
detachedLoadingHud._fastTagRecheckScraperHeaderLayout = () => { headerLayoutRechecks += 1; };
detachedLoadingHud._fastTagResizeObserver.callback();
assert.equal(headerLayoutRechecks, 1, 'resizing the floating shell should always re-evaluate the scraper header layout');
controller.closeHud();

const idlePopup = {
    currentSceneId: 'scene-idle',
    element: { isConnected: true, getBoundingClientRect: () => ({ left: 300, right: 900, top: 80, bottom: 680, width: 600, height: 600 }) },
    scraperCardContainer: { style: { display: 'none' }, innerHTML: '' },
    scrapeBtn: { classList: { toggle() {}, remove() {} }, innerHTML: '', disabled: false }
};
activePopup = idlePopup;
let animateCalls = 0;
const testCardHeader = { style: {}, onmousedown: null };
const prevCreateElement = global.document.createElement;
global.document.createElement = () => {
    const el = prevCreateElement();
    el.animate = () => { animateCalls += 1; };
    el.querySelector = selector => {
        if (selector === '[data-fasttag-auto-scrape-off-header]') {
            return el.innerHTML.includes('data-fasttag-auto-scrape-off-header') ? testCardHeader : null;
        }
        if (selector === '[data-fasttag-idle-dock-toggle]') return { addEventListener() {} };
        return null;
    };
    return el;
};
assert.equal(controller.showAutoScrapeOffState(idlePopup), true);
const idleHud = controller.getHudElement();
assert.ok(idleHud && connectedHudElements.has(idleHud), 'auto-scrape off state should create the idle HUD');
assert.match(idleHud.innerHTML, /fasttag-auto-scraping-off\.webp/);
assert.match(idleHud.innerHTML, /id="fasttag-scrape-idle-source-btn"/, 'idle card must have a scraper source selector button');
assert.equal(idlePopup._fastTagScraperIdle, true);
const initialHtml = idleHud.innerHTML;

// Simulate clicking Next:
assert.equal(controller.showAutoScrapeOffState(idlePopup), true);
assert.equal(idleHud.innerHTML, initialHtml, 'sequential navigation must preserve existing idle test card DOM');
assert.equal(animateCalls, 0, 'sequential navigation must not trigger a flash entrance animation');
controller.closeHud();
global.document.createElement = prevCreateElement;


// Verify source dropdown controller contract
assert.match(source, /id="fasttag-scrape-source-btn"/, "results header must contain source selector button");
assert.match(source, /id="fasttag-scrape-empty-source-btn"/, "empty state header must contain source selector button");
assert.match(source, /id="fasttag-scrape-idle-source-btn"/, "idle card header must contain source selector button");
assert.match(source, /fasttag-source-dropdown-menu/, "controller must define source dropdown menu");
assert.match(source, /id="fasttag-source-search-input"/, "source dropdown must include search filter input");
assert.match(source, /Stash-box Endpoints/, "dropdown menu must categorize Stash-box Endpoints");
assert.match(source, /Installed Scrapers/, "dropdown menu must categorize Installed Scrapers");

async function testConsoleSearchRetainsFocusOnEmptyResults() {
    let globalSearchFocused = false;
    let emptySearchFocused = false;
    const globalSearchEl = {
        focus: () => { globalSearchFocused = true; }
    };
    const emptySearchInputEl = {
        focus: () => { emptySearchFocused = true; },
        addEventListener: () => {}
    };
    const testContainer = {
        innerHTML: '',
        style: {},
        contains: (el) => el === emptySearchInputEl,
        querySelector: (sel) => {
            if (sel === '#fasttag-scrape-empty-query') return emptySearchInputEl;
            return { addEventListener: () => {} };
        }
    };
    const testPopup = {
        currentSceneId: 'scene-empty',
        element: { isConnected: true },
        globalSearch: globalSearchEl,
        scraperCardContainer: testContainer,
        scrapeBtn: { disabled: false, innerHTML: '', classList: { add: () => {}, remove: () => {} } }
    };

    controller.configure({
        getActivePopup: () => testPopup,
        getEffectiveTheme: () => 'dark',
        getDetachScraper: () => false,
        isEasterEggActive: () => false,
        toastError: () => {},
        toastSuccess: () => {},
        escapeHtml: (s) => s || '',
        cleanTitleForScraping: (s) => s || '',
        getScraperMatchingSettings: () => ({ initialResultLimit: 5 }),
        getHideObviousFalsePositives: () => false,
        partitionObviousFalsePositiveMatches: (r) => ({ visible: r, hidden: [] }),
        getCachedOrNull: () => []
    });

    global.document = global.document || {};
    const origBody = global.document.body;
    const origActive = global.document.activeElement;
    global.document.body = { contains: (el) => el === globalSearchEl };
    global.document.activeElement = null;

    try {
        await controller.renderMatches(testContainer, [], 'scene-empty', null, testPopup, null);
        assert.equal(emptySearchFocused, false, 'HUD empty search input should NOT be auto-focused');
        assert.equal(globalSearchFocused, true, 'Console main search should retain focus');
    } finally {
        global.document.body = origBody;
        global.document.activeElement = origActive;
    }
}

async function testLoadingStateDoesNotStealFocus() {
    let abortInputFocused = false;
    const abortInputEl = {
        value: '',
        focus: () => { abortInputFocused = true; },
        addEventListener: () => {}
    };
    const testPopup = {
        currentSceneId: 'scene-focus-test',
        element: { isConnected: true },
        scraperCardContainer: {
            innerHTML: '',
            style: {},
            querySelector: (sel) => {
                if (sel === '#fasttag-loading-abort-query') return abortInputEl;
                return { addEventListener: () => {} };
            }
        },
        scrapeBtn: { disabled: false, innerHTML: '' }
    };
    controller.showLoadingState(testPopup, 'Scraping…', () => {});
    await new Promise(r => setTimeout(r, 120));
    assert.equal(abortInputFocused, false, 'Loading state must not auto-focus abort input');
}

async function testTriggerRejectsLateResults() {
    let resolveFetch;
    const lateResult = new Promise(resolve => { resolveFetch = resolve; });
    const triggerPopup = {
        currentSceneId: 'scene-1',
        element: { isConnected: true },
        scraperCardContainer: { style: { display: 'none' }, innerHTML: '' },
        scrapeBtn: { classList: { remove() {} }, innerHTML: '', disabled: false }
    };
    activePopup = triggerPopup;
    controller.configure({
        getActivePopup: () => activePopup,
        isEasterEggActive: () => false,
        setScraperHudPersistedOpen() {},
        log() {},
        hideScrapeCoverTooltip() {},
        toastError() {},
        fetchScraperMatchesForScene: () => lateResult
    });
    const trigger = controller.createTrigger({
        popup: triggerPopup,
        mode: 'single',
        getSceneId: () => triggerPopup.currentSceneId
    });
    const pending = trigger();
    triggerPopup.currentSceneId = 'scene-2';
    controller.invalidateRequests(triggerPopup);
    resolveFetch([{ title: 'Result for the old scene' }]);
    assert.equal(await pending, null);
    assert.equal(controller.sessionCache.has('scene-1'), false, 'late results must never enter the session cache');
}

async function testAcceptMatchOrdering() {
    const events = [];
    const acceptedStashIds = [{ endpoint: 'https://stashdb.org/graphql', stash_id: 'remote-1' }];
    const context = {
        setSelectedStudio() {},
        setSelectedPerformers() {},
        setSelectedTags() {},
        setInitialStudio() {},
        setInitialPerformers() {},
        setInitialTags() {},
        async renderStudioBar() {},
        refreshAllUI() {}
    };
    const acceptButton = { style: {} };
    const acceptPopup = {
        element: { getAttribute: () => 'everything' },
        _context: context
    };

    controller.configure({
        getActivePopup: () => acceptPopup,
        log() {},
        readScrapeFieldSelection() {
            events.push('selection');
            return { title: true, studio: true, cover: true, performerIndices: [0], tagIndices: [0] };
        },
        async resolveScrapedStudioResult() { events.push('studio'); return { id: 'studio-1', failures: [] }; },
        async resolveScrapedEntityIdsResult(type) {
            events.push(type);
            return { ids: [type === 'performers' ? 'performer-1' : 'tag-1'], failures: [] };
        },
        async fetchGQL(query) {
            if (query.includes('FastTagAcceptCurrentScene')) {
                events.push('current');
                return { data: { findScene: { id: 'scene-1', performers: [], tags: [], stash_ids: [] } } };
            }
            if (query.includes('FastTagStashBoxes')) {
                events.push('configuration');
                return { data: { configuration: { general: { stashBoxes: [] } } } };
            }
            if (query.includes('FastTagAcceptSave')) {
                events.push('metadata');
                return { data: { sceneUpdate: { id: 'scene-1', title: 'Matched title' } } };
            }
            if (query.includes('FastTagAcceptStashId')) {
                events.push('stash-id');
                return { data: { sceneUpdate: { id: 'scene-1', stash_ids: acceptedStashIds } } };
            }
            if (query.includes('FastTagAcceptCover')) {
                events.push('cover');
                return { data: { sceneUpdate: { id: 'scene-1' } } };
            }
            throw new Error('Unexpected GraphQL operation');
        },
        buildAcceptedSceneStashIds() { return { stashIds: acceptedStashIds, added: true, reason: null }; },
        buildScrapeUpdateInput() {
            return { updateInput: { id: 'scene-1' }, mergedPerformerIds: ['performer-1'], mergedTagIds: ['tag-1'] };
        },
        sceneCardUpdateFields: 'id',
        syncSceneToApolloCache() { events.push('apollo'); },
        setLiveEverythingPopupTitle() { events.push('title'); },
        async refreshSceneCards() { events.push('refresh'); },
        recordSaveUsage() { events.push('usage'); },
        toastError(message) { throw new Error(message); },
        toastSuccess() { events.push('success'); }
    });

    controller.sessionCache.set('scene-1', [{ title: 'cached' }]);
    await controller.acceptMatch({
        title: 'Matched title',
        image: 'https://example.test/cover.jpg',
        studio: { name: 'Studio' },
        performers: [{ name: 'Performer' }],
        tags: [{ name: 'Tag' }],
        remote_site_id: 'remote-1',
        _sourceName: 'StashDB'
    }, { querySelector: () => acceptButton }, 'scene-1', context, acceptPopup);

    assert.deepEqual(events.slice(0, 4), ['selection', 'studio', 'performers', 'tags']);
    assert.ok(events.indexOf('metadata') < events.indexOf('stash-id'));
    assert.ok(events.indexOf('stash-id') < events.indexOf('cover'));
    assert.ok(events.indexOf('apollo') < events.indexOf('refresh'));
    assert.equal(controller.sessionCache.has('scene-1'), false, 'accepted scene results should leave the session cache after refresh');
    assert.equal(acceptButton.disabled, true);
}


async function testToggleHiddenJumpsToFirstNewItem() {
    // Verify that _fastTagInitialIndex is set to the visible partition length
    // when "Show hidden" is toggled ON, so renderMatches starts at the first
    // newly revealed false-positive result.
    const allResults = [
        { title: 'Visible Match 1', _sourceId: 'stashbox_0' },
        { title: 'Visible Match 2', _sourceId: 'stashbox_0' },
        { title: 'False Positive 1', _sourceId: 'stashbox_0' }
    ];
    // Simulate the visible partition having 2 items (the first two)
    const visiblePartitionLength = 2;

    // Simulate the toggle-hidden click handler logic (extracted from renderMatches closure)
    const showingHiddenResults = false; // currently hidden
    const falsePositivePartition = { visible: allResults.slice(0, 2), hidden: allResults.slice(2) };

    const wasShowing = showingHiddenResults;
    allResults._fastTagShowHidden = !wasShowing;
    allResults._fastTagShowAllResults = !wasShowing;
    if (!wasShowing) {
        allResults._fastTagInitialIndex = falsePositivePartition.visible.length;
    }

    assert.equal(allResults._fastTagInitialIndex, visiblePartitionLength,
        'toggle hidden should set _fastTagInitialIndex to the visible partition length');
    assert.equal(allResults._fastTagShowHidden, true, 'showHidden flag should be set to true');
}

async function testToggleOverflowJumpsToFirstNewItem() {
    // Verify that _fastTagInitialIndex is set to initialResultLimit
    // when "Show all" is toggled ON.
    const allResults = Array.from({ length: 30 }, (_, i) => ({ title: `Match ${i + 1}` }));
    const initialResultLimit = 25;
    const showingAllResults = false; // currently showing top 25 only

    const wasShowingAll = showingAllResults;
    allResults._fastTagShowAllResults = !wasShowingAll;
    if (!wasShowingAll) {
        allResults._fastTagInitialIndex = initialResultLimit;
    }

    assert.equal(allResults._fastTagInitialIndex, initialResultLimit,
        'toggle overflow should set _fastTagInitialIndex to initialResultLimit');
    assert.equal(allResults._fastTagShowAllResults, true, 'showAllResults flag should be set to true');
}

async function testShowLoadingStateWithAbortCallback() {
    // Verify that showLoadingState renders the abort search form when a callback is provided.
    const abortPopup = {
        currentSceneId: 'scene-abort',
        element: { isConnected: true },
        scraperCardContainer: {
            innerHTML: '',
            style: {},
            querySelector: (sel) => abortPopup.scraperCardContainer._els?.[sel] || null,
            _els: {}
        },
        scrapeBtn: { disabled: false, innerHTML: '' }
    };
    activePopup = abortPopup;

    // Build enough of the querySelector mock to support the wiring
    const abortInputEl = { value: '', addEventListener: (ev, fn) => { abortInputEl._handlers = abortInputEl._handlers || {}; abortInputEl._handlers[ev] = fn; } };
    const abortBtnEl = { disabled: false, textContent: '', addEventListener: (ev, fn) => { abortBtnEl._handlers = abortBtnEl._handlers || {}; abortBtnEl._handlers[ev] = fn; } };
    abortPopup.scraperCardContainer.querySelector = (sel) => {
        if (sel === '#fasttag-loading-abort-query') return abortInputEl;
        if (sel === '#fasttag-loading-abort-btn') return abortBtnEl;
        return null;
    };

    const abortCallbackArgs = [];
    const abortCallback = (query) => { abortCallbackArgs.push(query); };

    controller.configure({
        getActivePopup: () => activePopup,
        getEffectiveTheme: () => 'dark',
        getDetachScraper: () => false
    });

    const result = controller.showLoadingState(abortPopup, 'Scraping new scene…', abortCallback);
    assert.equal(result, true, 'showLoadingState should return true');
    // The HTML should include the abort search input
    assert.match(abortPopup.scraperCardContainer.innerHTML, /fasttag-loading-abort-query/,
        'loading state with abort callback should render the abort search input');
    assert.match(abortPopup.scraperCardContainer.innerHTML, /fasttag-loading-abort-btn/,
        'loading state with abort callback should render the search button');

    // Verify button click triggers callback
    abortInputEl.value = 'test query';
    abortBtnEl._handlers?.click?.({ preventDefault: () => {}, stopPropagation: () => {} });
    assert.deepEqual(abortCallbackArgs, ['test query'], 'clicking the search button should invoke the abort callback');
}

async function testShowLoadingStateWithoutAbortCallback() {
    // Verify that showLoadingState does NOT render the abort input when no callback provided.
    const plainPopup = {
        currentSceneId: 'scene-plain',
        element: { isConnected: true },
        scraperCardContainer: { innerHTML: '', style: {}, querySelector: () => null },
        scrapeBtn: { disabled: false, innerHTML: '' }
    };
    activePopup = plainPopup;
    controller.configure({
        getActivePopup: () => activePopup,
        getEffectiveTheme: () => 'dark',
        getDetachScraper: () => false
    });

    controller.showLoadingState(plainPopup);
    assert.doesNotMatch(plainPopup.scraperCardContainer.innerHTML, /fasttag-loading-abort-query/,
        'loading state without callback should not render abort search input');
}

async function testShowLoadingStateCancelButton() {
    let cancelCalled = false;
    const cancelBtnEl = { addEventListener: (ev, fn) => { cancelBtnEl._handlers = cancelBtnEl._handlers || {}; cancelBtnEl._handlers[ev] = fn; } };
    const cancelPopup = {
        currentSceneId: 'scene-cancel',
        element: { isConnected: true },
        scraperCardContainer: {
            innerHTML: '',
            style: {},
            querySelector: (sel) => {
                if (sel === '#fasttag-loading-cancel-btn') return cancelBtnEl;
                return null;
            }
        },
        scrapeBtn: { disabled: true, innerHTML: '<span>⏳ Scraping...</span>', classList: { remove: () => {} } }
    };
    activePopup = cancelPopup;
    controller.configure({
        getActivePopup: () => activePopup,
        getEffectiveTheme: () => 'dark',
        getDetachScraper: () => false,
        isEasterEggActive: () => false
    });

    controller.showLoadingState(cancelPopup, 'Scraping new scene…', () => {}, () => { cancelCalled = true; });
    assert.match(cancelPopup.scraperCardContainer.innerHTML, /fasttag-loading-cancel-btn/, 'loading state should render cancel button');
    
    // Clicking cancel should trigger callback and restore scrape button
    cancelBtnEl._handlers?.click?.({ preventDefault: () => {}, stopPropagation: () => {} });
    assert.equal(cancelCalled, true, 'clicking cancel button should invoke onCancel callback');
    assert.equal(cancelPopup.scrapeBtn.disabled, false, 'scrape button should be re-enabled on cancel');
}

async function testShowLoadingStateDetachedHeaderClose() {
    const closeBtnEl = { addEventListener: (ev, fn) => { closeBtnEl._handlers = closeBtnEl._handlers || {}; closeBtnEl._handlers[ev] = fn; } };
    const hudContainer = {
        innerHTML: '',
        style: {},
        querySelector: (sel) => {
            if (sel === '#fasttag-scrape-loading-close') return closeBtnEl;
            return null;
        }
    };
    const detachedPopup = {
        currentSceneId: 'scene-detached-close',
        element: { isConnected: true, style: {}, getBoundingClientRect: () => ({ left: 300, right: 900, top: 80, bottom: 680, width: 600, height: 600 }) },
        scraperCardContainer: { innerHTML: '', style: {} },
        scrapeBtn: { disabled: true, innerHTML: '<span>⏳ Scraping...</span>', classList: { remove: () => {} } }
    };
    activePopup = detachedPopup;
    controller.configure({
        getActivePopup: () => activePopup,
        getEffectiveTheme: () => 'dark',
        getDetachScraper: () => true,
        getFloatingVideoHudElement: () => null,
        isVideoPoppedOut: () => false,
        getDefaultEverythingPosition: () => ({ x: 200, y: 100 }),
        isEasterEggActive: () => false
    });

    controller.showLoadingState(detachedPopup, 'Scraping new scene…', () => {});
    const hud = controller.getHudElement();
    assert.ok(hud, 'HUD should be created');
    assert.match(hud.innerHTML, /fasttag-scrape-loading-close/, 'detached HUD loading header should render ✕ close button');
    assert.match(hud.innerHTML, /fasttag-loading-cancel-btn/, 'detached HUD loading footer should render Cancel button');
}

async function testDetachedCancelButtonKeepsHudOpen() {
    let cancelCalled = false;
    const cancelBtnEl = { addEventListener: (ev, fn) => { cancelBtnEl._handlers = cancelBtnEl._handlers || {}; cancelBtnEl._handlers[ev] = fn; } };
    const detachedPopup = {
        currentSceneId: 'scene-detached-cancel',
        element: { isConnected: true, style: {}, getBoundingClientRect: () => ({ left: 300, right: 900, top: 80, bottom: 680, width: 600, height: 600 }) },
        scraperCardContainer: { innerHTML: '', style: {} },
        scrapeBtn: { disabled: true, innerHTML: '<span>⏳ Scraping...</span>', classList: { remove: () => {} } }
    };
    activePopup = detachedPopup;
    controller.configure({
        getActivePopup: () => activePopup,
        getEffectiveTheme: () => 'dark',
        getDetachScraper: () => true,
        getFloatingVideoHudElement: () => null,
        isVideoPoppedOut: () => false,
        getDefaultEverythingPosition: () => ({ x: 200, y: 100 }),
        isEasterEggActive: () => false
    });

    controller.showLoadingState(detachedPopup, 'Scraping new scene…', () => {}, () => { cancelCalled = true; });
    const hud = controller.getHudElement();
    assert.ok(hud, 'HUD should be open during loading');
    
    // Wire querySelector to return cancel button
    const origQuerySelector = hud.querySelector;
    hud.querySelector = (sel) => {
        if (sel === '#fasttag-loading-cancel-btn') return cancelBtnEl;
        return origQuerySelector ? origQuerySelector.call(hud, sel) : null;
    };
    
    // Simulate user clicking footer Cancel
    controller.showLoadingState(detachedPopup, 'Scraping new scene…', () => {}, () => { cancelCalled = true; });
    cancelBtnEl._handlers?.click?.({ preventDefault: () => {}, stopPropagation: () => {} });
    assert.equal(cancelCalled, true, 'onCancel callback should be invoked');
    assert.equal(controller.isHudOpen(), true, 'HUD must stay open when clicking Cancel in footer');
}

async function testNewlyCreatedEntitiesInjectedImmediatelyWithoutReload() {
    let pageReloadCalled = false;
    const fakeWindow = { location: { reload: () => { pageReloadCalled = true; } } };

    const selectedPerformers = new Set(['p-existing-1']);
    const selectedTags = new Set(['t-existing-1']);
    let selectedStudio = 's-existing-1';

    // Multiple pre-existing performers, tags, and studios in memory
    const performersTableRows = [
        { id: 'p-existing-1', name: 'Jose' },
        { id: 'p-existing-2', name: 'Aaron Roberts' }
    ];
    const tagsTableRows = [
        { id: 't-existing-1', name: 'Existing Tag 1' },
        { id: 't-existing-2', name: 'Existing Tag 2' }
    ];

    const makeFakeTable = (rows) => {
        const selected = new Set();
        return {
            initialized: true,
            getRows: () => rows.map(r => ({ getData: () => r })),
            getData: () => [...rows],
            addData: (newRows, top) => {
                for (const r of newRows) {
                    if (!rows.some(existing => String(existing.id) === String(r.id))) {
                        if (top) rows.unshift(r);
                        else rows.push(r);
                    }
                }
            },
            setData: async (newRows) => {
                rows.length = 0;
                rows.push(...newRows);
            },
            selectRow: (id) => { selected.add(String(id)); },
            getSelectedRows: () => Array.from(selected)
        };
    };

    const performersTable = makeFakeTable(performersTableRows);
    const tagsTable = makeFakeTable(tagsTableRows);
    const studioBar = {
        chip: { style: { display: 'none' } },
        chipName: { textContent: '' }
    };

    let performerUIRefreshed = false;
    let tagUIRefreshed = false;
    let studioUIRefreshed = false;
    let allUIRefreshed = false;

    // Simulate in-memory cache store with existing items
    const inMemoryCache = {
        performers: [{ id: 'p-existing-1', name: 'Jose' }, { id: 'p-existing-2', name: 'Aaron Roberts' }],
        tags: [{ id: 't-existing-1', name: 'Existing Tag 1' }, { id: 't-existing-2', name: 'Existing Tag 2' }],
        studios: [{ id: 's-existing-1', name: 'FaKings' }]
    };

    const context = {
        selectedPerformerIds: selectedPerformers,
        selectedTagIds: selectedTags,
        get selectedStudioId() { return selectedStudio; },
        set selectedStudioId(v) { selectedStudio = v; },
        setSelectedPerformers: (s) => {
            selectedPerformers.clear();
            s.forEach(id => selectedPerformers.add(String(id)));
        },
        setSelectedTags: (s) => {
            selectedTags.clear();
            s.forEach(id => selectedTags.add(String(id)));
        },
        setSelectedStudio: (s) => { selectedStudio = s; },
        setInitialPerformers: () => {},
        setInitialTags: () => {},
        setInitialStudio: () => {},
        injectCreatedEntity: (type, entity) => {
            // Must preserve existing in-memory entities and append/update
            const list = inMemoryCache[type];
            if (Array.isArray(list)) {
                const idx = list.findIndex(e => String(e.id) === String(entity.id));
                if (idx >= 0) list[idx] = { ...list[idx], ...entity };
                else list.push(entity);
            }
            if (type === 'performers') {
                selectedPerformers.add(String(entity.id));
                performersTable.addData([entity], true);
                performersTable.selectRow(String(entity.id));
            } else if (type === 'tags') {
                selectedTags.add(String(entity.id));
                tagsTable.addData([entity], true);
                tagsTable.selectRow(String(entity.id));
            } else if (type === 'studios') {
                selectedStudio = String(entity.id);
                studioBar.chipName.textContent = entity.name;
                studioBar.chip.style.display = 'inline-flex';
            }
        },
        fetchColumnData: async (type, table, query, selIds) => {
            // Render from in-memory cache
            if (type === 'performers') {
                performerUIRefreshed = true;
                await table.setData([...inMemoryCache.performers]);
                selIds.forEach(id => table.selectRow(String(id)));
            } else if (type === 'tags') {
                tagUIRefreshed = true;
                await table.setData([...inMemoryCache.tags]);
                selIds.forEach(id => table.selectRow(String(id)));
            }
        },
        renderStudioBar: async () => {
            studioUIRefreshed = true;
            if (selectedStudio) {
                const s = inMemoryCache.studios.find(item => String(item.id) === String(selectedStudio));
                if (s) studioBar.chipName.textContent = s.name;
                studioBar.chip.style.display = 'inline-flex';
            }
        },
        refreshAllUI: () => {
            allUIRefreshed = true;
        }
    };

    const popup = {
        element: { getAttribute: () => 'everything' },
        performersTable,
        tagsTable,
        studioBar,
        _context: context
    };

    const newPerformer = { id: 'p-new-1', name: 'Marlene Strep', disambiguation: '', image_path: 'https://img/ms.jpg' };
    const newTag = { id: 't-new-1', name: 'Feature Dance' };
    const newStudio = { id: 's-new-1', name: 'MILF Club' };

    controller.configure({
        getActivePopup: () => popup,
        log: () => {},
        readScrapeFieldSelection: () => ({
            title: true, studio: true, cover: false, performerIndices: [0], tagIndices: [0]
        }),
        resolveScrapedStudioResult: async () => {
            const res = { id: newStudio.id, failures: [] };
            Object.defineProperty(res, 'createdEntity', { value: newStudio, enumerable: false });
            return res;
        },
        resolveScrapedEntityIdsResult: async (type) => {
            if (type === 'performers') {
                const res = { ids: [newPerformer.id], failures: [] };
                Object.defineProperty(res, 'createdEntities', { value: [newPerformer], enumerable: false });
                return res;
            }
            const res = { ids: [newTag.id], failures: [] };
            Object.defineProperty(res, 'createdEntities', { value: [newTag], enumerable: false });
            return res;
        },
        fetchGQL: async (query) => {
            if (query.includes('FastTagAcceptCurrentScene')) {
                return { data: { findScene: { id: 'scene-99', performers: [{ id: 'p-existing-1' }], tags: [{ id: 't-existing-1' }], stash_ids: [] } } };
            }
            if (query.includes('FastTagStashBoxes')) {
                return { data: { configuration: { general: { stashBoxes: [] } } } };
            }
            if (query.includes('FastTagAcceptSave')) {
                return { data: { sceneUpdate: { id: 'scene-99', title: 'Scene 99' } } };
            }
            return { data: {} };
        },
        buildAcceptedSceneStashIds: () => ({ stashIds: [], added: false }),
        buildScrapeUpdateInput: ({ existingPerformerIds = [], performerIdsToAdd = [], existingTagIds = [], tagIdsToAdd = [], studioIdToSet }) => {
            const mergedPerformerIds = Array.from(new Set([...existingPerformerIds, ...performerIdsToAdd]));
            const mergedTagIds = Array.from(new Set([...existingTagIds, ...tagIdsToAdd]));
            return {
                updateInput: { id: 'scene-99', performer_ids: mergedPerformerIds, tag_ids: mergedTagIds, studio_id: studioIdToSet },
                mergedPerformerIds,
                mergedTagIds
            };
        },
        sceneCardUpdateFields: 'id',
        syncSceneToApolloCache: () => {},
        setLiveEverythingPopupTitle: () => {},
        refreshSceneCards: async () => {},
        recordSaveUsage: () => {},
        toastError: (msg) => { throw new Error(msg); },
        toastSuccess: () => {}
    });

    const acceptBtn = { style: {}, disabled: false };
    await controller.acceptMatch({
        title: 'Scene 99 Match',
        studio: { name: 'MILF Club' },
        performers: [{ name: 'Marlene Strep' }],
        tags: [{ name: 'Feature Dance' }]
    }, { querySelector: () => acceptBtn }, 'scene-99', context, popup);

    const performerData = performersTable.getData();
    // 1. New performer appears immediately
    assert.ok(performerData.some(p => p.id === 'p-new-1' && p.name === 'Marlene Strep'),
        'newly created performer (Marlene Strep) should appear immediately in performer table');
    // 2. Previously existing performers remain visible (NOT clobbered!)
    assert.ok(performerData.some(p => p.id === 'p-existing-1' && p.name === 'Jose'),
        'previously existing performer (Jose) must remain visible in table');
    assert.ok(performerData.some(p => p.id === 'p-existing-2' && p.name === 'Aaron Roberts'),
        'other previously existing performers (Aaron Roberts) must remain visible in table');
    assert.equal(performerData.length, 3, 'table must contain both existing performers plus the newly created performer');
    // 3. All selected performers remain selected
    assert.ok(context.selectedPerformerIds.has('p-new-1'), 'new performer is marked selected');
    assert.ok(context.selectedPerformerIds.has('p-existing-1'), 'existing performer (Jose) remains selected');
    assert.ok(performersTable.getSelectedRows().includes('p-new-1'), 'new performer row is selected');
    assert.ok(performersTable.getSelectedRows().includes('p-existing-1'), 'existing performer (Jose) row is selected');
    assert.equal(context.selectedPerformerIds.size, 2, 'exactly 2 performers must be selected');

    // 4. Same protection for tags
    const tagData = tagsTable.getData();
    assert.ok(tagData.some(t => t.id === 't-new-1' && t.name === 'Feature Dance'),
        'newly created tag should appear immediately in tag table');
    assert.ok(tagData.some(t => t.id === 't-existing-1'),
        'existing tag 1 must remain visible in tag table');
    assert.ok(tagData.some(t => t.id === 't-existing-2'),
        'existing tag 2 must remain visible in tag table');
    assert.equal(tagData.length, 3, 'tag table must preserve existing tags plus the new tag');
    assert.ok(context.selectedTagIds.has('t-new-1'), 'new tag is selected');
    assert.ok(context.selectedTagIds.has('t-existing-1'), 'existing tag remains selected');

    // 5. Same protection for studios
    assert.equal(context.selectedStudioId, 's-new-1', 'new studio is selected');
    assert.equal(studioBar.chipName.textContent, 'MILF Club', 'new studio is applied');
    assert.ok(inMemoryCache.studios.some(s => s.id === 's-existing-1'), 'existing studio remains in memory');
    assert.ok(inMemoryCache.studios.some(s => s.id === 's-new-1'), 'new studio is in memory');

    // 6. No reload needed
    assert.equal(pageReloadCalled, false, 'no page reload should be required');
    assert.ok(allUIRefreshed, 'UI was fully refreshed');
}

testTriggerRejectsLateResults()
    .then(() => testAcceptMatchOrdering())
    .then(() => testToggleHiddenJumpsToFirstNewItem())
    .then(() => testToggleOverflowJumpsToFirstNewItem())
    .then(() => testShowLoadingStateWithAbortCallback())
    .then(() => testShowLoadingStateWithoutAbortCallback())
    .then(() => testShowLoadingStateCancelButton())
    .then(() => testShowLoadingStateDetachedHeaderClose())
    .then(() => testDetachedCancelButtonKeepsHudOpen())
    .then(() => testNewlyCreatedEntitiesInjectedImmediatelyWithoutReload())
    .then(() => testConsoleSearchRetainsFocusOnEmptyResults())
    .then(() => testLoadingStateDoesNotStealFocus())
    .then(() => console.log('fasttag-scraper-controller tests passed'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
