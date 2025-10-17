import {
    cleanUpAfterTests,
    cleanUPTestDataFromDB,
    createTestContext, createTestUser,
    deleteRecordsInTest,
    generateUserDid,
    getAcceptVoteRefAndRecord,
    getSuiteId,
    getTopicVersionRefAndRecord, MockSessionAgent,
    processRecordsInTest
} from "#/tests/test-utils.js";
import {AppContext} from "#/setup.js";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {splitUri} from "#/utils/uri.js";
import {getTopicVersion} from "#/services/wiki/topics.js";
import {getTopicVersionVotes} from "#/services/wiki/votes.js";

const testSuite = getSuiteId(__filename)


describe('Create topic vote', { timeout: 20000 }, () => {
    let ctx : AppContext | undefined
    beforeAll(async () => {
        ctx = await createTestContext()
        await ctx.worker?.setup(ctx)
    })

    beforeEach(async () => {
        await cleanUPTestDataFromDB(ctx!, testSuite)
        await ctx!.worker?.clear()
    })

    it("should add one to the counter", async () => {
        const user = await createTestUser(ctx!, "test.cabildo.ar", testSuite)
        const topicVersion = await getTopicVersionRefAndRecord(
            ctx!,
            "tema de prueba",
            "texto",
            new Date(),
            user,
            testSuite
        )

        await processRecordsInTest(ctx!, [topicVersion])

        const {data: topicView1} = await getTopicVersion(
            ctx!, topicVersion.ref.uri, user)


        expect(topicView1).not.toBeFalsy()
        expect(topicView1!.currentVersion).toEqual(topicVersion.ref.uri)

        const vote = await getAcceptVoteRefAndRecord(
            ctx!,
            topicVersion.ref,
            new Date(),
            user,
            testSuite,
        )
        await processRecordsInTest(ctx!, [vote])

        const {data: topicView2} = await getTopicVersion(ctx!, topicVersion.ref.uri, user)

        expect(topicView2).not.toBeFalsy()
        expect(topicView2!.status).not.toBeFalsy()
        expect(topicView2!.status!.accepted).toEqual(true)
        expect(topicView2!.status!.voteCounts.length).toEqual(1)
        expect(topicView2!.status!.voteCounts[0].accepts).toEqual(1)
        expect(topicView2!.status!.voteCounts[0].rejects).toEqual(0)

        const vote2 = await getAcceptVoteRefAndRecord(
            ctx!,
            topicVersion.ref,
            new Date(),
            user,
            testSuite
        )
        await processRecordsInTest(ctx!, [vote2])

        const {data: topicView3} = await getTopicVersion(ctx!, topicVersion.ref.uri, user)
        expect(topicView3).not.toBeFalsy()
        expect(topicView3!.status).not.toBeFalsy()
        expect(topicView3!.status!.accepted).toEqual(true)
        expect(topicView3!.status!.voteCounts.length).toEqual(1)
        expect(topicView3!.status!.voteCounts[0].accepts).toEqual(1)
        expect(topicView3!.status!.voteCounts[0].rejects).toEqual(0)

        const agent = new MockSessionAgent(user)
        const votes = await getTopicVersionVotes(ctx!, agent, topicVersion.ref.uri)
        expect(votes).not.toBeFalsy()
        expect(votes!.length).toEqual(1)

        await deleteRecordsInTest(ctx!, [vote.ref.uri])

        const {data: topicView4} = await getTopicVersion(ctx!, topicVersion.ref.uri, user)

        expect(topicView4).not.toBeFalsy()
        expect(topicView4!.status).not.toBeFalsy()
        expect(topicView4!.status!.accepted).toEqual(true)
        expect(topicView4!.status!.voteCounts.length).toEqual(1)
        expect(topicView4!.status!.voteCounts[0].accepts).toEqual(0)
        expect(topicView4!.status!.voteCounts[0].rejects).toEqual(0)

        const votes2 = await getTopicVersionVotes(ctx!, agent, topicVersion.ref.uri)
        expect(votes2).not.toBeFalsy()
        expect(votes2!.length).toEqual(0)
    })

    afterAll(async () => cleanUpAfterTests(ctx!))
})