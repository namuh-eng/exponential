#!/bin/bash

# create_worktree.sh - Create a new worktree with .env and config symlinked
# Usage: ./hack/create_worktree.sh [worktree_name] [base_branch]
# If no name provided, generates a unique one
# If no base branch provided, uses current branch

set -e

generate_unique_name() {
    local adjectives=("swift" "bright" "clever" "smooth" "quick" "clean" "sharp" "neat" "cool" "fast")
    local nouns=("fix" "task" "work" "dev" "patch" "branch" "code" "build" "test" "run")
    local adj=${adjectives[$RANDOM % ${#adjectives[@]}]}
    local noun=${nouns[$RANDOM % ${#nouns[@]}]}
    echo "${adj}_${noun}_$(date +%H%M)"
}

# Parse arguments
if [ $# -ge 2 ]; then
    WORKTREE_NAME="$1"
    BASE_BRANCH="$2"
elif [ $# -eq 1 ]; then
    WORKTREE_NAME="$1"
    BASE_BRANCH=$(git branch --show-current)
else
    WORKTREE_NAME=$(generate_unique_name)
    BASE_BRANCH=$(git branch --show-current)
fi

REPO_BASE_NAME=$(basename "$(pwd)")
WORKTREES_ROOT="${WORKTREES_ROOT:-/home/jaeyunha/wt}"
WORKTREES_BASE="${WORKTREES_ROOT}/${REPO_BASE_NAME}"
WORKTREE_PATH="${WORKTREES_BASE}/${WORKTREE_NAME}"
ORIGINAL_DIR=$(pwd)

echo "Creating worktree: ${WORKTREE_NAME}"
echo "Location: ${WORKTREE_PATH}"
echo "Base branch: ${BASE_BRANCH}"

mkdir -p "$WORKTREES_BASE"

if [ -d "$WORKTREE_PATH" ]; then
    echo "Error: Worktree directory already exists: $WORKTREE_PATH"
    exit 1
fi

# Clean up stale registration if needed
if git worktree list --porcelain | grep -q "worktree $WORKTREE_PATH"; then
    git worktree remove --force "$WORKTREE_PATH" 2>/dev/null || git worktree prune
fi

# Create worktree
if git show-ref --verify --quiet "refs/heads/${WORKTREE_NAME}"; then
    echo "Using existing branch: ${WORKTREE_NAME}"
    git worktree add "$WORKTREE_PATH" "$WORKTREE_NAME"
else
    echo "Creating new branch: ${WORKTREE_NAME}"
    git worktree add -b "$WORKTREE_NAME" "$WORKTREE_PATH" "$BASE_BRANCH"
fi

# Copy .claude directory if it exists
if [ -d ".claude" ]; then
    echo "Copying .claude directory..."
    cp -r .claude "$WORKTREE_PATH/"
fi

# Symlink all .env files (except .env.example) from main repo
while IFS= read -r env_file; do
    rel_path="${env_file#${ORIGINAL_DIR}/}"
    target_dir="${WORKTREE_PATH}/$(dirname "$rel_path")"
    mkdir -p "$target_dir"
    rm -f "${WORKTREE_PATH}/${rel_path}"
    ln -s "${env_file}" "${WORKTREE_PATH}/${rel_path}"
    echo "Symlinked ${rel_path}"
done < <(find "${ORIGINAL_DIR}" -name ".env" -o -name ".env.*" | grep -v '\.env\.example' | grep -v '/.git/' | grep -v '/node_modules/')

# Symlink .mcp.json if it exists
if [ -f "${ORIGINAL_DIR}/.mcp.json" ]; then
    rm -f "${WORKTREE_PATH}/.mcp.json"
    ln -s "${ORIGINAL_DIR}/.mcp.json" "${WORKTREE_PATH}/.mcp.json"
    echo "Symlinked .mcp.json"
fi

# Install dependencies
echo "Installing dependencies..."
cd "$WORKTREE_PATH"
npm install --silent
cd - > /dev/null

echo ""
echo "Worktree created successfully!"
echo "Path: ${WORKTREE_PATH}"
echo "Branch: ${WORKTREE_NAME}"
echo ""
echo "To use:  cd ${WORKTREE_PATH}"
echo "To remove:  git worktree remove ${WORKTREE_PATH} && git branch -D ${WORKTREE_NAME}"
