/**
 * GENERATED CODE - DO NOT MODIFY
 */
import {
  createServer as createXrpcServer,
  Server as XrpcServer,
  type Options as XrpcOptions,
  type AuthVerifier,
  type StreamAuthVerifier,
} from '@atproto/xrpc-server'
import { schemas } from './lexicons.js'
import * as ArCabildoabiertoFeedGetFeed from './types/ar/cabildoabierto/feed/getFeed.js'
import * as AppBskyFeedDescribeFeedGenerator from './types/app/bsky/feed/describeFeedGenerator.js'
import * as AppBskyFeedGetActorFeeds from './types/app/bsky/feed/getActorFeeds.js'
import * as AppBskyFeedGetActorLikes from './types/app/bsky/feed/getActorLikes.js'
import * as AppBskyFeedGetAuthorFeed from './types/app/bsky/feed/getAuthorFeed.js'
import * as AppBskyFeedGetFeedGenerator from './types/app/bsky/feed/getFeedGenerator.js'
import * as AppBskyFeedGetFeedGenerators from './types/app/bsky/feed/getFeedGenerators.js'
import * as AppBskyFeedGetFeed from './types/app/bsky/feed/getFeed.js'
import * as AppBskyFeedGetFeedSkeleton from './types/app/bsky/feed/getFeedSkeleton.js'
import * as AppBskyFeedGetLikes from './types/app/bsky/feed/getLikes.js'
import * as AppBskyFeedGetListFeed from './types/app/bsky/feed/getListFeed.js'
import * as AppBskyFeedGetPosts from './types/app/bsky/feed/getPosts.js'
import * as AppBskyFeedGetPostThread from './types/app/bsky/feed/getPostThread.js'
import * as AppBskyFeedGetQuotes from './types/app/bsky/feed/getQuotes.js'
import * as AppBskyFeedGetRepostedBy from './types/app/bsky/feed/getRepostedBy.js'
import * as AppBskyFeedGetSuggestedFeeds from './types/app/bsky/feed/getSuggestedFeeds.js'
import * as AppBskyFeedGetTimeline from './types/app/bsky/feed/getTimeline.js'
import * as AppBskyFeedSearchPosts from './types/app/bsky/feed/searchPosts.js'
import * as AppBskyFeedSendInteractions from './types/app/bsky/feed/sendInteractions.js'
import * as ComAtprotoRepoApplyWrites from './types/com/atproto/repo/applyWrites.js'
import * as ComAtprotoRepoCreateRecord from './types/com/atproto/repo/createRecord.js'
import * as ComAtprotoRepoDeleteRecord from './types/com/atproto/repo/deleteRecord.js'
import * as ComAtprotoRepoDescribeRepo from './types/com/atproto/repo/describeRepo.js'
import * as ComAtprotoRepoGetRecord from './types/com/atproto/repo/getRecord.js'
import * as ComAtprotoRepoImportRepo from './types/com/atproto/repo/importRepo.js'
import * as ComAtprotoRepoListMissingBlobs from './types/com/atproto/repo/listMissingBlobs.js'
import * as ComAtprotoRepoListRecords from './types/com/atproto/repo/listRecords.js'
import * as ComAtprotoRepoPutRecord from './types/com/atproto/repo/putRecord.js'
import * as ComAtprotoRepoUploadBlob from './types/com/atproto/repo/uploadBlob.js'

export const AR_CABILDOABIERTO_FEED = {
  DefsRequestLess: 'ar.cabildoabierto.feed.defs#requestLess',
  DefsRequestMore: 'ar.cabildoabierto.feed.defs#requestMore',
  DefsClickthroughItem: 'ar.cabildoabierto.feed.defs#clickthroughItem',
  DefsClickthroughAuthor: 'ar.cabildoabierto.feed.defs#clickthroughAuthor',
  DefsClickthroughReposter: 'ar.cabildoabierto.feed.defs#clickthroughReposter',
  DefsClickthroughEmbed: 'ar.cabildoabierto.feed.defs#clickthroughEmbed',
  DefsContentModeUnspecified:
    'ar.cabildoabierto.feed.defs#contentModeUnspecified',
  DefsContentModeVideo: 'ar.cabildoabierto.feed.defs#contentModeVideo',
  DefsInteractionSeen: 'ar.cabildoabierto.feed.defs#interactionSeen',
  DefsInteractionLike: 'ar.cabildoabierto.feed.defs#interactionLike',
  DefsInteractionRepost: 'ar.cabildoabierto.feed.defs#interactionRepost',
  DefsInteractionReply: 'ar.cabildoabierto.feed.defs#interactionReply',
  DefsInteractionQuote: 'ar.cabildoabierto.feed.defs#interactionQuote',
  DefsInteractionShare: 'ar.cabildoabierto.feed.defs#interactionShare',
}
export const APP_BSKY_FEED = {
  DefsRequestLess: 'app.bsky.feed.defs#requestLess',
  DefsRequestMore: 'app.bsky.feed.defs#requestMore',
  DefsClickthroughItem: 'app.bsky.feed.defs#clickthroughItem',
  DefsClickthroughAuthor: 'app.bsky.feed.defs#clickthroughAuthor',
  DefsClickthroughReposter: 'app.bsky.feed.defs#clickthroughReposter',
  DefsClickthroughEmbed: 'app.bsky.feed.defs#clickthroughEmbed',
  DefsContentModeUnspecified: 'app.bsky.feed.defs#contentModeUnspecified',
  DefsContentModeVideo: 'app.bsky.feed.defs#contentModeVideo',
  DefsInteractionSeen: 'app.bsky.feed.defs#interactionSeen',
  DefsInteractionLike: 'app.bsky.feed.defs#interactionLike',
  DefsInteractionRepost: 'app.bsky.feed.defs#interactionRepost',
  DefsInteractionReply: 'app.bsky.feed.defs#interactionReply',
  DefsInteractionQuote: 'app.bsky.feed.defs#interactionQuote',
  DefsInteractionShare: 'app.bsky.feed.defs#interactionShare',
}

export function createServer(options?: XrpcOptions): Server {
  return new Server(options)
}

export class Server {
  xrpc: XrpcServer
  ar: ArNS
  app: AppNS
  com: ComNS

  constructor(options?: XrpcOptions) {
    this.xrpc = createXrpcServer(schemas, options)
    this.ar = new ArNS(this)
    this.app = new AppNS(this)
    this.com = new ComNS(this)
  }
}

export class ArNS {
  _server: Server
  cabildoabierto: ArCabildoabiertoNS

  constructor(server: Server) {
    this._server = server
    this.cabildoabierto = new ArCabildoabiertoNS(server)
  }
}

export class ArCabildoabiertoNS {
  _server: Server
  actor: ArCabildoabiertoActorNS
  data: ArCabildoabiertoDataNS
  embed: ArCabildoabiertoEmbedNS
  feed: ArCabildoabiertoFeedNS
  wiki: ArCabildoabiertoWikiNS

  constructor(server: Server) {
    this._server = server
    this.actor = new ArCabildoabiertoActorNS(server)
    this.data = new ArCabildoabiertoDataNS(server)
    this.embed = new ArCabildoabiertoEmbedNS(server)
    this.feed = new ArCabildoabiertoFeedNS(server)
    this.wiki = new ArCabildoabiertoWikiNS(server)
  }
}

export class ArCabildoabiertoActorNS {
  _server: Server

  constructor(server: Server) {
    this._server = server
  }
}

export class ArCabildoabiertoDataNS {
  _server: Server

  constructor(server: Server) {
    this._server = server
  }
}

export class ArCabildoabiertoEmbedNS {
  _server: Server

  constructor(server: Server) {
    this._server = server
  }
}

export class ArCabildoabiertoFeedNS {
  _server: Server

  constructor(server: Server) {
    this._server = server
  }

  getFeed<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      ArCabildoabiertoFeedGetFeed.Handler<ExtractAuth<AV>>,
      ArCabildoabiertoFeedGetFeed.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'ar.cabildoabierto.feed.getFeed' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }
}

export class ArCabildoabiertoWikiNS {
  _server: Server

  constructor(server: Server) {
    this._server = server
  }
}

export class AppNS {
  _server: Server
  bsky: AppBskyNS

  constructor(server: Server) {
    this._server = server
    this.bsky = new AppBskyNS(server)
  }
}

export class AppBskyNS {
  _server: Server
  feed: AppBskyFeedNS
  embed: AppBskyEmbedNS
  richtext: AppBskyRichtextNS

  constructor(server: Server) {
    this._server = server
    this.feed = new AppBskyFeedNS(server)
    this.embed = new AppBskyEmbedNS(server)
    this.richtext = new AppBskyRichtextNS(server)
  }
}

export class AppBskyFeedNS {
  _server: Server

  constructor(server: Server) {
    this._server = server
  }

  describeFeedGenerator<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedDescribeFeedGenerator.Handler<ExtractAuth<AV>>,
      AppBskyFeedDescribeFeedGenerator.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.describeFeedGenerator' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getActorFeeds<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetActorFeeds.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetActorFeeds.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getActorFeeds' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getActorLikes<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetActorLikes.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetActorLikes.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getActorLikes' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getAuthorFeed<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetAuthorFeed.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetAuthorFeed.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getAuthorFeed' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getFeedGenerator<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetFeedGenerator.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetFeedGenerator.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getFeedGenerator' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getFeedGenerators<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetFeedGenerators.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetFeedGenerators.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getFeedGenerators' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getFeed<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetFeed.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetFeed.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getFeed' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getFeedSkeleton<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetFeedSkeleton.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetFeedSkeleton.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getFeedSkeleton' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getLikes<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetLikes.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetLikes.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getLikes' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getListFeed<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetListFeed.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetListFeed.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getListFeed' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getPosts<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetPosts.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetPosts.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getPosts' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getPostThread<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetPostThread.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetPostThread.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getPostThread' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getQuotes<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetQuotes.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetQuotes.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getQuotes' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getRepostedBy<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetRepostedBy.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetRepostedBy.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getRepostedBy' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getSuggestedFeeds<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetSuggestedFeeds.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetSuggestedFeeds.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getSuggestedFeeds' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getTimeline<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedGetTimeline.Handler<ExtractAuth<AV>>,
      AppBskyFeedGetTimeline.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.getTimeline' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  searchPosts<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedSearchPosts.Handler<ExtractAuth<AV>>,
      AppBskyFeedSearchPosts.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.searchPosts' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  sendInteractions<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      AppBskyFeedSendInteractions.Handler<ExtractAuth<AV>>,
      AppBskyFeedSendInteractions.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'app.bsky.feed.sendInteractions' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }
}

export class AppBskyEmbedNS {
  _server: Server

  constructor(server: Server) {
    this._server = server
  }
}

export class AppBskyRichtextNS {
  _server: Server

  constructor(server: Server) {
    this._server = server
  }
}

export class ComNS {
  _server: Server
  atproto: ComAtprotoNS

  constructor(server: Server) {
    this._server = server
    this.atproto = new ComAtprotoNS(server)
  }
}

export class ComAtprotoNS {
  _server: Server
  repo: ComAtprotoRepoNS

  constructor(server: Server) {
    this._server = server
    this.repo = new ComAtprotoRepoNS(server)
  }
}

export class ComAtprotoRepoNS {
  _server: Server

  constructor(server: Server) {
    this._server = server
  }

  applyWrites<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      ComAtprotoRepoApplyWrites.Handler<ExtractAuth<AV>>,
      ComAtprotoRepoApplyWrites.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'com.atproto.repo.applyWrites' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  createRecord<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      ComAtprotoRepoCreateRecord.Handler<ExtractAuth<AV>>,
      ComAtprotoRepoCreateRecord.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'com.atproto.repo.createRecord' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  deleteRecord<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      ComAtprotoRepoDeleteRecord.Handler<ExtractAuth<AV>>,
      ComAtprotoRepoDeleteRecord.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'com.atproto.repo.deleteRecord' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  describeRepo<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      ComAtprotoRepoDescribeRepo.Handler<ExtractAuth<AV>>,
      ComAtprotoRepoDescribeRepo.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'com.atproto.repo.describeRepo' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  getRecord<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      ComAtprotoRepoGetRecord.Handler<ExtractAuth<AV>>,
      ComAtprotoRepoGetRecord.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'com.atproto.repo.getRecord' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  importRepo<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      ComAtprotoRepoImportRepo.Handler<ExtractAuth<AV>>,
      ComAtprotoRepoImportRepo.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'com.atproto.repo.importRepo' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  listMissingBlobs<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      ComAtprotoRepoListMissingBlobs.Handler<ExtractAuth<AV>>,
      ComAtprotoRepoListMissingBlobs.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'com.atproto.repo.listMissingBlobs' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  listRecords<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      ComAtprotoRepoListRecords.Handler<ExtractAuth<AV>>,
      ComAtprotoRepoListRecords.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'com.atproto.repo.listRecords' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  putRecord<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      ComAtprotoRepoPutRecord.Handler<ExtractAuth<AV>>,
      ComAtprotoRepoPutRecord.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'com.atproto.repo.putRecord' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }

  uploadBlob<AV extends AuthVerifier>(
    cfg: ConfigOf<
      AV,
      ComAtprotoRepoUploadBlob.Handler<ExtractAuth<AV>>,
      ComAtprotoRepoUploadBlob.HandlerReqCtx<ExtractAuth<AV>>
    >,
  ) {
    const nsid = 'com.atproto.repo.uploadBlob' // @ts-ignore
    return this._server.xrpc.method(nsid, cfg)
  }
}

type SharedRateLimitOpts<T> = {
  name: string
  calcKey?: (ctx: T) => string | null
  calcPoints?: (ctx: T) => number
}
type RouteRateLimitOpts<T> = {
  durationMs: number
  points: number
  calcKey?: (ctx: T) => string | null
  calcPoints?: (ctx: T) => number
}
type HandlerOpts = { blobLimit?: number }
type HandlerRateLimitOpts<T> = SharedRateLimitOpts<T> | RouteRateLimitOpts<T>
type ConfigOf<Auth, Handler, ReqCtx> =
  | Handler
  | {
      auth?: Auth
      opts?: HandlerOpts
      rateLimit?: HandlerRateLimitOpts<ReqCtx> | HandlerRateLimitOpts<ReqCtx>[]
      handler: Handler
    }
type ExtractAuth<AV extends AuthVerifier | StreamAuthVerifier> = Extract<
  Awaited<ReturnType<AV>>,
  { credentials: unknown }
>
