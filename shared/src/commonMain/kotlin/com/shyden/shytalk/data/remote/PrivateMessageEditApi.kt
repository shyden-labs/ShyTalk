package com.shyden.shytalk.data.remote

/**
 * SHY-0614: the server routes that edit and recall a private or group
 * message. One home for both apps, so Android and iOS make the same calls
 * and read the same answers.
 */
object PrivateMessageEditApi {
    fun editPath(
        conversationId: String,
        messageId: String,
    ): String = "/api/conversations/$conversationId/messages/$messageId"

    fun recallPath(
        conversationId: String,
        messageId: String,
    ): String = "${editPath(conversationId, messageId)}/recall"

    fun editBody(newText: String): Map<String, String> = mapOf("text" to newText)

    /**
     * The route answers 409 to a second recall by the sender; a resent request
     * whose first answer was lost has still recalled the message.
     */
    fun recallAlreadyDone(statusCode: Int): Boolean = statusCode == HTTP_CONFLICT

    private const val HTTP_CONFLICT = 409
}
