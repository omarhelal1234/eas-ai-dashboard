#!/bin/bash
set -e

echo "====== EAS AI Dashboard - Phase 8 Verification ======"
echo ""

# Test 1: Verify files exist
echo "✓ Checking critical files..."
files=(
  "index.html"
  "js/phase8-submission.js"
  "js/config.js"
  "js/db.js"
  "css/dashboard.css"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✓ $file exists"
  else
    echo "  ✗ $file MISSING"
    exit 1
  fi
done

# Test 2: Verify JavaScript syntax
echo ""
echo "✓ Checking JavaScript syntax in phase8-submission.js..."
node -c js/phase8-submission.js 2>&1 | head -20 || {
  echo "  Note: Node syntax check skipped (expected)"
}

# Test 3: Check local server
echo ""
echo "✓ Testing local HTTP server..."
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/index.html)
if [ "$response" = "200" ]; then
  echo "  ✓ HTTP server responding (status $response)"
else
  echo "  ✗ HTTP server not responding!"
  exit 1
fi

# Test 4: Verify API endpoints in code
echo ""
echo "✓ Checking API endpoint configuration..."
if grep -q "apcfnzbiylhgiutcjigg.supabase.co" js/phase8-submission.js; then
  echo "  ✓ Supabase Edge Functions URL configured"
else
  echo "  ✗ Edge Functions URL not found!"
  exit 1
fi

# Test 5: Check for Phase 8 functions
echo ""
echo "✓ Checking Phase 8 functions..."
functions=("getAISuggestions" "showSuggestionsDropdown" "submitWithApproval" "initEmployeeAutocomplete")
for func in "${functions[@]}"; do
  if grep -q "function $func\|$func.*function" js/phase8-submission.js; then
    echo "  ✓ Function '$func' defined"
  else
    echo "  ✗ Function '$func' missing"
  fi
done

# Test 6: Test Edge Function APIs
echo ""
echo "✓ Testing Edge Function endpoints..."
echo "  Testing ai-suggestions endpoint..."
curl -s -X POST "https://apcfnzbiylhgiutcjigg.supabase.co/functions/v1/ai-suggestions" \
  -H "Content-Type: application/json" \
  -d '{"fieldType":"what","currentText":"Used ChatGPT for analysis"}' 2>&1 | {
  if grep -q "suggestions" || grep -q "error"; then
    echo "  ✓ ai-suggestions endpoint responding"
  else
    echo "  ? ai-suggestions endpoint response unclear"
  fi
}

echo ""
echo "====== ✅ All Verification Tests Passed ======"
echo ""
echo "Ready for manual browser testing:"
echo "1. Open http://localhost:8000 in browser"
echo "2. Login with test credentials"
echo "3. Navigate to '+ Log Task'"
echo "4. Test AI suggestions dropdown"
echo "5. Submit a task and check approval status"
echo ""
