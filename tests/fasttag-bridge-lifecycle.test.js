'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testScript = path.join(__dirname, 'test_bridge_lifecycle.py');
const result = spawnSync('python3', [testScript], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 30000
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

assert.equal(result.status, 0, `Bridge lifecycle tests failed with status ${result.status}`);
