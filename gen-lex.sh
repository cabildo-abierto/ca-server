./node_modules/.bin/lex gen-api --yes ./src/lex-api \
  ./lexicons/ar/cabildoabierto/actor/* \
  ./lexicons/ar/cabildoabierto/data/* \
  ./lexicons/ar/cabildoabierto/embed/* \
  ./lexicons/ar/cabildoabierto/feed/* \
  ./lexicons/ar/cabildoabierto/wiki/* \
  ./lexicons/ar/cabildoabierto/label/* \
  ./lexicons/ar/cabildoabierto/notification/* \
  ./lexicons/com/atproto/repo/* \
  ./lexicons/com/atproto/identity/* \
  ./lexicons/com/atproto/label/* \
  ./lexicons/com/atproto/server/* \
  ./lexicons/com/atproto/moderation/* \
  ./lexicons/com/atproto/lexicon/* \
  ./lexicons/com/atproto/sync/* \
  ./lexicons/com/atproto/temp/* \
  ./lexicons/com/atproto/admin/* \
  ./lexicons/app/bsky/feed/* \
  ./lexicons/app/bsky/embed/* \
  ./lexicons/app/bsky/graph/* \
  ./lexicons/app/bsky/labeler/* \
  ./lexicons/app/bsky/notification/* \
  ./lexicons/app/bsky/unspecced/* \
  ./lexicons/app/bsky/video/* \
  ./lexicons/app/bsky/actor/* \
  ./lexicons/app/bsky/richtext/* \
  ./lexicons/chat/bsky/convo/* \
  ./lexicons/chat/bsky/actor/* \
  ./lexicons/chat/bsky/moderation/*


./node_modules/.bin/lex gen-server --yes ./src/lex-server \
  ./lexicons/ar/cabildoabierto/actor/* \
  ./lexicons/ar/cabildoabierto/data/* \
  ./lexicons/ar/cabildoabierto/embed/* \
  ./lexicons/ar/cabildoabierto/feed/* \
  ./lexicons/ar/cabildoabierto/wiki/* \
  ./lexicons/ar/cabildoabierto/label/* \
  ./lexicons/ar/cabildoabierto/notification/* \
  ./lexicons/com/atproto/repo/* \
  ./lexicons/com/atproto/identity/* \
  ./lexicons/com/atproto/label/* \
  ./lexicons/com/atproto/server/* \
  ./lexicons/com/atproto/moderation/* \
  ./lexicons/com/atproto/lexicon/* \
  ./lexicons/com/atproto/sync/* \
  ./lexicons/com/atproto/temp/* \
  ./lexicons/com/atproto/admin/* \
  ./lexicons/app/bsky/feed/* \
  ./lexicons/app/bsky/embed/* \
  ./lexicons/app/bsky/graph/* \
  ./lexicons/app/bsky/labeler/* \
  ./lexicons/app/bsky/notification/* \
  ./lexicons/app/bsky/unspecced/* \
  ./lexicons/app/bsky/video/* \
  ./lexicons/app/bsky/actor/* \
  ./lexicons/app/bsky/richtext/* \
  ./lexicons/chat/bsky/convo/* \
  ./lexicons/chat/bsky/actor/* \
  ./lexicons/chat/bsky/moderation/*


./node_modules/.bin/lex gen-api --yes ../cabildo-abierto/src/lex-api \
  ../ca-server/lexicons/ar/cabildoabierto/actor/* \
  ../ca-server/lexicons/ar/cabildoabierto/data/* \
  ../ca-server/lexicons/ar/cabildoabierto/embed/* \
  ../ca-server/lexicons/ar/cabildoabierto/feed/* \
  ../ca-server/lexicons/ar/cabildoabierto/wiki/* \
  ../ca-server/lexicons/ar/cabildoabierto/label/* \
  ../ca-server/lexicons/ar/cabildoabierto/notification/* \
  ../ca-server/lexicons/com/atproto/label/* \
  ../ca-server/lexicons/com/atproto/repo/* \
  ../ca-server/lexicons/app/bsky/feed/* \
  ../ca-server/lexicons/app/bsky/graph/* \
  ../ca-server/lexicons/app/bsky/actor/* \
  ../ca-server/lexicons/app/bsky/embed/* \
  ../ca-server/lexicons/app/bsky/labeler/* \
  ../ca-server/lexicons/app/bsky/richtext/*

node fix-imports.mjs
cd ../cabildo-abierto && node fix-imports.js
