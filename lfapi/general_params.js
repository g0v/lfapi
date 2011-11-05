config = require('../config.js');
exports.config = config;

// ==========================================================================
// Handle generic request parameters
// --------------------------------------------------------------------------


exports.addLimitAndOffset = function (query, params) {
  var limit = params.limit ? parseInt(params.limit) : config.settings.result_row_limit.default
  if (limit > config.settings.result_row_limit.max) {
    limit = config.settings.result_row_limit.default;
  }
  query.limit(limit);
  query.offset(params.offset ? parseInt(params.offset) : 0);
}

// add member related options to a db query according to parameters given by client
// TODO limit to access privileges
exports.addMemberOptions = function (req, query, params, relation) {
  var table_name = 'member';
  if (relation) {
    table_name = relation + '_member';
  };
  var member_id = params[relation ? relation + '_member_id' : 'member_id'];
  var member_disabled = params[relation ? relation + '_member_disabled' : 'member_disabled'] ? true : false;
  var member_search = params[relation ? relation + '_member_search' : 'member_search'];
  var member_order_by_name = parseInt(params[relation ? relation + '_member_order_by_name' : 'member_order_by_name']);
  var member_order_by_created = parseInt(params[relation ? relation + '_member_order_by_created' : 'member_order_by_created']);
  
  if (member_id) {
    query.addWhere(['"' + table_name + '"."id" IN (??)', member_id.split(',')]);
  };
  /*if (member_disabled == true) {
    query.addWhere('"' + table_name + '"."active" = FALSE');
  } else {
    query.addWhere('"' + table_name + '"."active" = TRUE OR "' + table_name + '"."active" ISNULL');
  };*/
  if (member_search) {
    query.addWhere(['"' + table_name + '"."text_search_data" @@ text_search_query(?)', member_search]);
  };
  if (member_order_by_name) {
    query.addOrderBy('"' + table_name + '"."name"')
  }
  if (member_order_by_created) {
    query.addOrderBy('"' + table_name + '"."created" DESC')
  }
};

// add policy related options to a db query according to parameters given by client
exports.addPolicyOptions = function (req, query, params) {
  if (params.policy_id) {
    query.addWhere(['policy.id IN (??)', params.policy_id.split(',')]);
  }
  if (params.policy_order_by_name) {
    query.addOrderBy('"policy"."name"')
  }
};

// add unit related options to a db query according to parameters given by client
exports.addUnitOptions = function (req, query, params) {
  if (params.unit_id) {
    query.addWhere(['"unit"."id" IN (??)', params.unit_id.split(',')]);
  }
  if (params.unit_parent_id) {
    query.addWhere(['"unit"."parent_id" = ?', params.unit_parent_id]);
  }
  if (params.unit_without_parent) {
    query.addWhere('"unit"."parent_id" ISNULL');
  }
  if (params.unit_disabled) {
    query.addWhere('"unit"."active" = FALSE');
  } else {
    query.addWhere('"unit"."active" = TRUE');
  }
  if (params.unit_order_by_name) {
    query.addOrderBy('"unit"."name"')
  }
}

// add area related options to a db query according to parameters given by client
exports.addAreaOptions = function (req, query, params) {
  exports.addUnitOptions(req, query, params);
  if (params.area_id) {
    query.addWhere(['"area"."id" IN (??)', params.area_id.split(',')]);
  }
  if (params.area_disabled) {
    query.addWhere('"area"."active" = FALSE');
  } else {
    query.addWhere('"area"."active" = TRUE');
  }
  if (req.current_access_level == 'member' && params.area_my) {
    query.addWhere(['"area"."id" IN (SELECT "area_id" FROM "membership" WHERE "member_id" = ?)', req.current_member_id]);
  }
  if (params.area_order_by_name) {
    query.addOrderBy('"area"."name"')
  }
}

// add issue related options to a db query according to parameters given by client
exports.addIssueOptions = function (req, query, params) {
  exports.addAreaOptions(req, query, params);
  exports.addPolicyOptions(req, query, params);
  
  if (params.issue_id) query.addWhere(['issue.id IN (??)', params.issue_id.split(',')]);

  if (params.issue_state) {
    var issue_state_string;
    if (params.issue_state == 'open') {
      issue_states = ['admission', 'discussion', 'verification', 'voting'];
    } else if (params.issue_state == 'closed') {
      issue_state_string = ['canceled_revoked_before_accepted', 'canceled_issue_not_accepted', 'canceled_after_revocation_during_discussion', 'canceled_after_revocation_during_verification', 'calculation', 'canceled_no_initiative_admitted', 'finished_without_winner', 'finished_with_winner'];
    } else {
      issue_states = params.issue_state.split(',');
    }
    query.addWhere(['"issue"."state" IN (??)', issue_states]);
  };
  
  if (params.issue_accepted) query.addWhere('"issue"."accepted" NOTNULL');
  if (params.issue_half_frozen) query.addWhere('"issue"."half_frozen" NOTNULL');
  if (params.issue_fully_frozen) query.addWhere('"issue"."fully_frozen" NOTNULL');
  if (params.issue_closed) query.addWhere('"issue"."closed" NOTNULL');
  if (params.issue_cleaned) query.addWhere('"issue"."cleaned" NOTNULL');
  
  if (params.issue_created_after) query.addWhere(['"issue"."created" >= ?', params.issue_created_after]);
  if (params.issue_created_before) query.addWhere(['"issue"."created" < ?', params.issue_created_before]);
  if (params.issue_accepted_after) query.addWhere(['"issue"."accepted" >= ?', params.issue_accepted_after]);
  if (params.issue_accepted_before) query.addWhere(['"issue"."accepted" < ?', params.issue_accepted_before]);
  if (params.issue_half_frozen_after) query.addWhere(['"issue"."half_frozen" >= ?', params.issue_half_frozen_after]);
  if (params.issue_half_frozen_before) query.addWhere(['"issue"."half_frozen" < ?', params.issue_half_frozen_before]);
  if (params.issue_fully_frozen_after) query.addWhere(['"issue"."fully_frozen" >= ?', params.issue_fully_frozen_after]);
  if (params.issue_fully_frozen_before) query.addWhere(['"issue"."fully_frozen" < ?', params.issue_fully_frozen_before]);
  if (params.issue_closed_after) query.addWhere(['"issue"."closed" >= ?', params.issue_closed_after]);
  if (params.issue_closed_before) query.addWhere(['"issue"."closed" < ?', params.issue_closed_before]);
  if (params.issue_cleaned_after) query.addWhere(['"issue."cleaned" >= ?', params.issue_cleaned_after]);
  if (params.issue_cleaned_before) query.addWhere(['"issue"."cleaned" < ?', params.issue_cleaned_before]);
  
  if (params.issue_state_time_left_below) {
    query.addWhere(['(case issue.state when \'admission\' then issue.created + issue.admission_time when \'discussion\' then issue.accepted + issue.discussion_time when \'verification\' then issue.half_frozen + issue.verification_time when \'voting\' then issue.fully_frozen + issue.voting_time end) - now() < ?', params.issue_state_time_left_below]);
  };
  
  if (params.issue_order_by_state_time_left) {
    query.addOrderBy('(case issue.state when \'admission\' then issue.created + issue.admission_time when \'discussion\' then issue.accepted + issue.discussion_time when \'verification\' then issue.half_frozen + issue.verification_time when \'voting\' then issue.fully_frozen + issue.voting_time end)');
  };
  
  if (params.issue_order_by_id) query.addOrderBy('"issue"."id"');
}

// add initiative related options to a db query according to parameters given by client
exports.addInitiativeOptions = function (req, query, params) {
  exports.addIssueOptions(req, query, params);
  if (params.initiative_id) {
    query.addWhere(['initiative.id IN (??)', params.initiative_id.split(',')]);
  }
  // TODO
  //query.from.push('JOIN initiator AS initiative_initiator ON initiative_initiator.initiative_id = initiative.id AND initiative_initiator.accepted JOIN member AS initiator_member ON initiator_member.id = initiative_initiator.member_id');  
  //query.from.push('JOIN supporter AS initiative_supporter ON initiative_supporter.initiative_id = initiative.id JOIN member AS supporter_member ON supporter_member.id = initiative_supporter.member_id');  
  //exports.addMemberOptions(query, params, 'initiator');
  //exports.addMemberOptions(query, params, 'supporter');
  
  if (params.initiative_revoked) query.addWhere('initiative.revoked NOTNULL');
  if (params.initiative_revoked_after) query.addWhere(['initiative.revoked >= ?', params.initiative_revoked_after]);
  if (params.initiative_revoked_before) query.addWhere(['initiative.revoked < ?', params.initiative_revoked_before]);
  if (params.initiative_revoked_by_member_id) query.addWhere(['initiative.revoked_by_member_id = ?', params.initiative_revoked_by_member_id]);
  if (params.initiative_suggested_initiative_id) query.addWhere(['initiative.suggested_initiative_id = ?', params.initiative_suggested_initiative_id]);

  if (params.initiative_admitted) query.addWhere('initiative.admitted NOTNULL');
  if (params.initiative_created_after) query.addWhere(['initiative.created >= ?', params.initiative_created_after]);
  if (params.initiative_created_before) query.addWhere(['initiative.created < ?',params.initiative_created_before]);
  if (params.initiative_admitted_after) query.addWhere(['initiative.admitted >= ?', params.initiative_admitted_after]);
  if (params.initiative_admitted_before) query.addWhere(['initiative.admitted < ?', params.initiative_admitted_before]);

  if (params.initiative_supporter_count_below) query.addWhere(['initiative.supporter_count < ?', params.initiative_supporter_count_below]);
  if (params.initiative_supporter_count_above) query.addWhere(['initiative.supporter_count >= ?', params.initiative_supporter_count_above]);

  if (params.initiative_attainable) query.addWhere('initiative.attainable');
  if (params.initiative_favored) query.addWhere('initiative.favored');
  if (params.initiative_unfavored) query.addWhere('initiative.unfavored');

  if (params.initiative_max_preliminary_rank) query.addWhere(['initiative.preliminary_rank <= ?', params.initiative_max_preliminary_rank]);
  if (params.initiative_max_final_rank) query.addWhere(['initiative.preliminary_rank <= ?', params.initiative_max_final_rank]);

  if (params.initiative_disqualified) query.addWhere('initiative.disqualified');
  if (params.initiative_winner) query.addWhere('initiative.winner');

  if (params.initiative_search) {
    query.addWhere(['initiative.text_search_data @@ text_search_query(?)', params.initiative_search]);
  };
  if (params.initiative_order_by_id) {
    query.addOrderBy('initiative.id');
  }
}

// add suggestion related options to a db query according to parameters given by client
exports.addSuggestionOptions = function (req, query, params) {
  exports.addInitiativeOptions(req, query, params);
  if (params.suggestion_id) {
    query.addWhere(['suggestion.id IN (??)', params.suggestion_id]);
  }
  if (params.suggestion_search) {
    query.addWhere(['suggestion.text_search_data @@ text_search_query(?)', params.suggestion_search]);
  };
  if (params.include_suggestion) {
    addObjectFields(query, 'suggestion');
  };
}
