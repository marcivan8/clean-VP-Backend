#!/usr/bin/env bash
# build-layer.sh
#
# Packages the Vibed caption fonts into an AWS Lambda Layer.
#
# The layer mounts at /opt/fonts/ inside Lambda. FontInstaller checks this path
# first — if fonts are there, no download is needed at render time (zero cold-start cost).
#
# Usage:
#   cd render-lambda
#   bash scripts/build-layer.sh
#   # → outputs vibed-fonts-layer.zip in render-lambda/
#   # Then deploy manually once:
#   #   aws lambda publish-layer-version \
#   #     --layer-name vibed-fonts \
#   #     --description "Vibed caption fonts for Revideo rendering" \
#   #     --zip-file fileb://vibed-fonts-layer.zip \
#   #     --compatible-runtimes nodejs20.x
#   #
#   #   aws lambda update-function-configuration \
#   #     --function-name YOUR_LAMBDA_FUNCTION_NAME \
#   #     --layers arn:aws:lambda:REGION:ACCOUNT_ID:layer:vibed-fonts:VERSION
#
# Font source: client/public/fonts/ (pre-built by the main Dockerfile via curl).
# If that directory is empty, run the Dockerfile build first, or download fonts
# manually using the jsDelivr URLs in render-lambda/fonts/fontRegistry.ts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FONTS_SRC="$REPO_ROOT/client/public/fonts"
LAYER_DIR="$SCRIPT_DIR/../layer-staging/fonts"
OUTPUT_ZIP="$SCRIPT_DIR/../vibed-fonts-layer.zip"

echo "→ Font source: $FONTS_SRC"
echo "→ Layer output: $OUTPUT_ZIP"

if [ ! -d "$FONTS_SRC" ]; then
    echo "❌  $FONTS_SRC not found. Run the main Docker build first to populate fonts."
    exit 1
fi

TTF_COUNT=$(find "$FONTS_SRC" -name "*.ttf" | wc -l | tr -d ' ')
if [ "$TTF_COUNT" -eq 0 ]; then
    echo "❌  No .ttf files found in $FONTS_SRC."
    echo "    Run: docker build -t vibed . && docker run --rm -v \$(pwd)/client/public/fonts:/out vibed cp -r /usr/src/app/client/public/fonts/. /out"
    exit 1
fi

echo "→ Found $TTF_COUNT .ttf files"

# Clean and recreate staging dir
rm -rf "$LAYER_DIR"
mkdir -p "$LAYER_DIR"

# Copy fonts flat into layer (FontInstaller looks for {file} directly in /opt/fonts/)
cp "$FONTS_SRC"/*.ttf "$LAYER_DIR/"

echo "→ Copied fonts to staging directory"

# Create zip with the expected Lambda Layer structure:
#   fonts/{file}.ttf  →  mounted at /opt/fonts/{file}.ttf
rm -f "$OUTPUT_ZIP"
cd "$SCRIPT_DIR/.."
zip -r vibed-fonts-layer.zip layer-staging/ -x "*.DS_Store"

# Rename layer-staging to fonts inside the zip so it mounts at /opt/fonts/
# (Layer zip structure: the top-level dirs become /opt/{dir}/)
rm -rf layer-staging
mkdir -p layer-staging/fonts
cp "$FONTS_SRC"/*.ttf layer-staging/fonts/
rm -f "$OUTPUT_ZIP"
zip -r vibed-fonts-layer.zip layer-staging/
rm -rf layer-staging

echo ""
echo "✅  Layer built: $OUTPUT_ZIP"
echo ""
echo "Deploy with:"
echo "  aws lambda publish-layer-version \\"
echo "    --layer-name vibed-fonts \\"
echo "    --description 'Vibed caption fonts for Revideo rendering' \\"
echo "    --zip-file fileb://vibed-fonts-layer.zip \\"
echo "    --compatible-runtimes nodejs20.x"
echo ""
echo "Then attach to your Lambda:"
echo "  aws lambda update-function-configuration \\"
echo "    --function-name YOUR_LAMBDA_FUNCTION_NAME \\"
echo "    --layers arn:aws:lambda:REGION:ACCOUNT_ID:layer:vibed-fonts:1"
echo ""
echo "Note: FontInstaller falls back to jsDelivr CDN if the layer is not attached."
echo "The layer is optional — it eliminates the ~200ms download cost per cold start."
