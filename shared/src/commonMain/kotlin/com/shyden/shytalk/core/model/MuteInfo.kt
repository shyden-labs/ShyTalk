package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.asBool
import com.shyden.shytalk.core.util.timestampToMillis

data class MuteInfo(
    val mutedUserId: String = "",
    val mutedBy: String = "",
    val mutedByName: String = "",
    val reason: String? = null,
    val mutedAt: Long = 0,
    val expiresAt: Long? = null,
    val isActive: Boolean = true,
) {
    /** True while this mute stops its member posting: active and not yet ended. */
    fun isInForceAt(nowMillis: Long): Boolean = isActive && (expiresAt == null || expiresAt > nowMillis)

    fun toMap(): Map<String, Any?> =
        mapOf(
            "mutedBy" to mutedBy,
            "mutedByName" to mutedByName,
            "reason" to reason,
            "mutedAt" to mutedAt,
            "expiresAt" to expiresAt,
            "isActive" to isActive,
        )

    /**
     * The `conversations/{id}/mutes/{mutedUserId}` row both apps write (SHY-0653):
     * [toMap] plus `userId`, which the server's account-deletion sweep reads.
     */
    fun toRow(): Map<String, Any?> = toMap() + ("userId" to mutedUserId)

    companion object {
        /** A new mute starting at [mutedAt]; [duration] null means permanent. */
        fun starting(
            mutedUserId: String,
            mutedBy: String,
            mutedByName: String,
            mutedAt: Long,
            duration: Long?,
            reason: String?,
        ): MuteInfo =
            MuteInfo(
                mutedUserId = mutedUserId,
                mutedBy = mutedBy,
                mutedByName = mutedByName,
                reason = reason,
                mutedAt = mutedAt,
                expiresAt = duration?.let { mutedAt + it },
            )

        fun fromMap(
            map: Map<String, Any?>,
            mutedUserId: String,
        ): MuteInfo {
            val mutedAt = map["mutedAt"]?.let { (it as? Long) ?: timestampToMillis(it) } ?: 0L
            // SHY-0653: rows written before the fix carry `duration` (ms) and no
            // `expiresAt`; they end at mutedAt + duration, as the rules read them.
            val legacyEnd = (map["duration"] as? Number)?.toLong()?.let { mutedAt + it }
            return MuteInfo(
                mutedUserId = mutedUserId,
                mutedBy = map["mutedBy"] as? String ?: "",
                mutedByName = map["mutedByName"] as? String ?: "",
                reason = map["reason"] as? String,
                mutedAt = mutedAt,
                expiresAt = map["expiresAt"]?.let { (it as? Long) ?: timestampToMillis(it) } ?: legacyEnd,
                isActive = map["isActive"].asBool(true),
            )
        }
    }
}
