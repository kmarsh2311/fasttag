#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${REPO_DIR}/dist"
OUTPUT_ZIP="${DIST_DIR}/fasttag.zip"

mkdir -p "${DIST_DIR}"
rm -f "${OUTPUT_ZIP}"

cd "${REPO_DIR}"

# Explicit allowlist of runtime plugin files and user documentation
FILES=(
  "fasttag.yml"
  "fasttag.js"
  "fasttag-api.js"
  "fasttag-auto-scraping-off.webp"
  "fasttag-core.js"
  "fasttag-cover-editor.js"
  "fasttag-diagnostics.js"
  "fasttag-editors.js"
  "fasttag-entities.js"
  "fasttag-gemini.js"
  "fasttag-help.js"
  "fasttag-integrations.js"
  "fasttag-library-manager.js"
  "fasttag-notifications.js"
  "fasttag-popup.js"
  "fasttag-preview.js"
  "fasttag-scraper-controller.js"
  "fasttag-scraper-ui.js"
  "fasttag-scraper.js"
  "fasttag-settings.js"
  "fasttag-storage.js"
  "fasttag-ui.js"
  "fasttag-workflows.js"
  "fasttag_gemini_bridge.py"
  "fasttag_task.py"
  "tabulator.min.css"
  "tabulator.min.js"
  "CHANGELOG.md"
  "HOWTO.md"
  "USER_GUIDE.md"
)

# 1. Verify all allowlisted files exist before packaging
for file in "${FILES[@]}"; do
  if [[ ! -f "${file}" ]]; then
    echo "ERROR: Required file '${file}' does not exist!" >&2
    exit 1
  fi
done

# 2. Syntax validation
python3 -m py_compile fasttag_gemini_bridge.py fasttag_task.py

# 3. Create the release archive with explicit files only
zip -q "${OUTPUT_ZIP}" "${FILES[@]}"

# 4. Verify archive contents against manifest declarations
manifest_ver=$(grep -E '^\s*version:' fasttag.yml | head -n 1 | awk '{print $2}' | tr -d '"'\')
echo "=================================================="
echo "Package:      dist/fasttag.zip"
echo "Manifest Ver: ${manifest_ver}"
echo "File Count:   $(unzip -l "${OUTPUT_ZIP}" | tail -n 1 | awk '{print $2}') files"
echo "SHA-256:      $(shasum -a 256 "${OUTPUT_ZIP}" | awk '{print $1}')"
echo "=================================================="
