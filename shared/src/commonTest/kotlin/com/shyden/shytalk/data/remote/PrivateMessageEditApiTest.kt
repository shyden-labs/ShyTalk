package com.shyden.shytalk.data.remote

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SHY-0614: the edit and recall calls both apps make. The paths and the 409
 * reading must match `express-api/src/routes/conversation-message-edits.js`
 * and `decideRecall` in `express-api/src/utils/message-history.js`.
 */
class PrivateMessageEditApiTest {
    @Test
    fun `edit path names the conversation and message`() =
        assertEquals("/api/conversations/c1/messages/m1", PrivateMessageEditApi.editPath("c1", "m1"))

    @Test
    fun `recall path ends in recall`() =
        assertEquals("/api/conversations/c1/messages/m1/recall", PrivateMessageEditApi.recallPath("c1", "m1"))

    @Test
    fun `edit body carries only the new text`() = assertEquals(mapOf("text" to "hi"), PrivateMessageEditApi.editBody("hi"))

    @Test
    fun `409 on recall means it is already done`() = assertTrue(PrivateMessageEditApi.recallAlreadyDone(409))

    @Test
    fun `403 on recall is a real failure`() = assertFalse(PrivateMessageEditApi.recallAlreadyDone(403))

    @Test
    fun `404 on recall is a real failure`() = assertFalse(PrivateMessageEditApi.recallAlreadyDone(404))

    @Test
    fun `500 on recall is a real failure`() = assertFalse(PrivateMessageEditApi.recallAlreadyDone(500))
}
