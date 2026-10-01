// Headless-only entry point for WASM arena builds.
// Ported from mobagen/apps/catchthecat/main.cpp headless mode (no GUI deps).
#include <iostream>
#include <string>
#include <vector>

#include "World.h"

static void printUsage() {
  std::cerr << "Usage: catchthecat [--headless --turn <cat|catcher> --size <size> --board <board_string>]\n";
  std::cerr << "  --headless: Run in headless mode\n";
  std::cerr << "  --turn: Specify whose turn it is (cat or catcher)\n";
  std::cerr << "  --size: Size of the board (odd number)\n";
  std::cerr << "  --board: Board configuration using . (empty), # (blocked), C (cat)\n";
}

static Point2D findCatPosition(const std::string& boardStr, int size) {
  int pos = 0;
  for (int i = 0; i < static_cast<int>(boardStr.length()); i++) {
    char c = boardStr[i];
    if (c == '.' || c == '#') {
      pos++;
      continue;
    } else if (c == 'C') {
      int y = pos / size;
      int x = pos % size;
      return {x - size / 2, y - size / 2};
    }
  }
  return {0, 0};
}

static std::vector<bool> parseBoardString(const std::string& boardStr, int size) {
  std::vector<bool> worldState(size * size, false);
  int validCharCount = 0;
  int expectedCount = size * size;

  for (int i = 0; i < static_cast<int>(boardStr.length()) && validCharCount < expectedCount; i++) {
    char c = boardStr[i];
    if (c == '#') {
      worldState[validCharCount++] = true;
    } else if (c == '.' || c == 'C') {
      worldState[validCharCount++] = false;
    }
  }

  if (validCharCount != expectedCount) {
    std::cerr << "Error: Found " << validCharCount << " valid characters, but expected " << expectedCount << " for a " << size << "x" << size
              << " board\n";
    return std::vector<bool>(size * size, false);
  }
  return worldState;
}

int main(int argc, char** argv) {
  bool isCatTurn = true;
  int size = 21;
  std::string boardStr = "";

  for (int i = 1; i < argc; i++) {
    std::string arg = argv[i];
    if (arg == "--headless") {
      // Always headless in WASM builds; flag accepted for CLI compatibility.
      continue;
    } else if (arg == "--turn" && i + 1 < argc) {
      std::string turn = argv[++i];
      if (turn == "cat")
        isCatTurn = true;
      else if (turn == "catcher")
        isCatTurn = false;
      else {
        std::cerr << "Error: Invalid turn value. Use 'cat' or 'catcher'\n";
        printUsage();
        return 1;
      }
    } else if (arg == "--size" && i + 1 < argc) {
      size = std::stoi(argv[++i]);
      if (size % 2 == 0 || size < 3) {
        std::cerr << "Error: Size must be an odd number >= 3\n";
        printUsage();
        return 1;
      }
    } else if (arg == "--board" && i + 1 < argc) {
      boardStr = argv[++i];
    } else {
      std::cerr << "Error: Unknown argument " << arg << "\n";
      printUsage();
      return 1;
    }
  }

  if (boardStr.empty()) {
    std::cerr << "Error: Board string is required for headless mode\n";
    printUsage();
    return 1;
  }

  CatWorld catWorld(size, isCatTurn, findCatPosition(boardStr, size), parseBoardString(boardStr, size));
  catWorld.step();
  std::cout << catWorld.moveDuration << std::endl;
  std::cout << catWorld.lastMove.x << "," << catWorld.lastMove.y << std::endl;
  return 0;
}
