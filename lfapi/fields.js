// ==========================================================================
// fields of main data structures
// --------------------------------------------------------------------------

exports.member =  ['id', 'name', 'organizational_unit', 'internal_posts', 'realname', 'birthday', 'address', 'email', 'xmpp_address', 'website', 'phone', 'mobile_phone', 'profession', 'external_memberships', 'external_posts', 'statement', 'active', 'locked', 'created', 'last_activity'];
exports.member_pseudonym = ['id', 'name'];
exports.policy = ['id', 'index', 'active', 'name', 'description', 'admission_time', 'discussion_time', 'verification_time', 'voting_time', 'issue_quorum_num', 'issue_quorum_den', 'initiative_quorum_num', 'initiative_quorum_den', 'direct_majority_num', 'direct_majority_den', 'direct_majority_strict', 'direct_majority_positive', 'direct_majority_non_negative', 'indirect_majority_num', 'indirect_majority_den', 'indirect_majority_strict', 'indirect_majority_positive', 'indirect_majority_non_negative', 'no_reverse_beat_path', 'no_multistage_majority'];
exports.unit = ['id', 'parent_id', 'active', 'name', 'description', 'member_count'];
exports.area = ['id', 'unit_id', 'active', 'name', 'description', 'direct_member_count', 'member_weight'];
exports.issue = ['id', 'area_id', 'policy_id', 'state', 'created', 'accepted', 'half_frozen', 'fully_frozen', 'closed', 'ranks_available', 'cleaned', 'admission_time', 'discussion_time', 'verification_time', 'voting_time', 'snapshot', 'latest_snapshot_event', 'population', 'voter_count', 'status_quo_schulze_rank'];
exports.initiative = ['issue_id', 'id', 'name', 'discussion_url', 'created', 'revoked', 'revoked_by_member_id', 'suggested_initiative_id', 'admitted', 'supporter_count', 'informed_supporter_count', 'satisfied_supporter_count', 'satisfied_informed_supporter_count', 'positive_votes', 'negative_votes', 'rank', 'direct_majority', 'indirect_majority', 'schulze_rank', 'better_than_status_quo', 'worse_than_status_quo', 'reverse_beat_path', 'multistage_majority', 'eligible', 'winner'];
exports.suggestion = ['initiative_id', 'id', 'created', 'author_id', 'name', 'formatting_engine', 'content', 'minus2_unfulfilled_count', 'minus2_fulfilled_count', 'minus1_unfulfilled_count', 'minus1_fulfilled_count', 'plus1_unfulfilled_count', 'plus1_fulfilled_count', 'plus2_unfulfilled_count', 'plus2_fulfilled_count'];
exports.suggestion_pseudonym = ['initiative_id', 'id', 'created', 'name', 'description', 'minus2_unfulfilled_count', 'minus2_fulfilled_count', 'minus1_unfulfilled_count', 'minus1_fulfilled_count', 'plus1_unfulfilled_count', 'plus1_fulfilled_count', 'plus2_unfulfilled_count', 'plus2_fulfilled_count'];

// add fields of a data structure to where AND group by clause of a query
exports.addObjectFields = function (query, clazz, field_class) {
  if (!field_class) { field_class = clazz };
  exports[field_class].forEach(function(field) {
    query.addField('"' + clazz + '"."' + field + '"', null, ['grouped']);
    //query.addGroupBy('"' + clazz + '"."' + '"' + field + '"');
  });
};
