const path = require('path')

require('dotenv').config({
  path: path.resolve(__dirname, '.env'),
})

// Native modules need lightweight Node/Jest replacements during unit tests.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

// Supabase Realtime requires a WebSocket implementation on Node 20.
if (!global.WebSocket) {
  global.WebSocket = require('ws')
}

