var stringthesizer = require('./stringthesizer.js');

var quoteLiteral = function(str) {
  if (str.search(/^"[^"]*"/) >= 0) return str;
  else return str.replace(/"/g, '""').replace(/[^\.]+/g, '"$&"');
};

function SQLQuery() {
}
SQLQuery.prototype.assemble = function(nextPlaceholder) {
  return stringthesizer.stringthesizer(
    {
      nextPlaceholder: nextPlaceholder,
      valueSeparator: ",",
      coerce: function(value) {
        if (value instanceof Selector) return value.toStructure();
        return value;
      }
    },
    this.toStructure()
  );
}

function Selector(from) {
  this._with = [];
  this._fields = [];
  this._distinct = false;
  this._distinctOn = [];
  this._from = [];
  this._where = [];
  this._groupBy = [];
  this._having = [];
  this._combine = [];
  this._orderBy = [];
  this._limit = null;
  this._offset = null;
  this._readLock = [];
  this._readLockAll = false;
  this._writeLock = [];
  this._writeLockAll = false;
  if (from != null) this.from(from);
}
Selector.prototype = new SQLQuery();
Selector.prototype.addWith = function(expression, selector) {
  this._with.push(['$ AS ($)', expression, selector]);
  return this;
};
Selector.prototype.addDistinctOn = function(expression) {
  if (this._distinct) throw "Cannot combine DISTINCT with DISTINCT ON.";
  this._distinctOn.push(expression);
  return this;
};
Selector.prototype.setDistinct = function() {
  if (this._distinctOn.length > 0) throw "Cannot combine DISTINCT with DISTINCT ON.";
  this._distinct = true;
  return this;
};
Selector.prototype.addFrom = function(expression, alias, condition) {
  var first = this._from.length == 0;
  if (!first) {
    if (condition == null) this._from.push('CROSS JOIN')
    else this._from.push('INNER JOIN')
  }
  if (expression instanceof Selector) {
    if (alias == null) this._from.push(['($) AS "subquery"', expression]);
    else this._from.push(['($) AS "$"', expression, alias]);
  } else {
    if (alias == null) this._from.push(expression);
    else this._from.push(['$ AS "$"', expression, alias]);
  }
  if (condition != null) {
    if (first) {
      this.addWhere(condition);
    } else {
      this._from.push('ON');
      this._from.push(condition);
    }
  }
  return this;
};
Selector.prototype.addWhere = function(expression) {
  this._where.push(['($)', expression]);
  return this;
};
Selector.prototype.addGroupBy = function(expression) {
  this._groupBy.push(expression);
  return this;
};
Selector.prototype.addHaving = function(expression) {
  this._having.push(['($)', expression]);
  return this;
};
Selector.prototype.addCombine = function(expression) {
  this._combine.push(expression);
  return this;
};
Selector.prototype.addOrderBy = function(expression) {
  this._orderBy.push(expression);
  return this;
};
Selector.prototype.limit = function(count) {
  this._limit = count;
  return this;
};
Selector.prototype.offset = function(count) {
  this._offset = count;
  return this;
};
Selector.prototype.forShare = function() {
  this._readLockAll = true;
  return this;
};
Selector.prototype.forShareOf = function(expression) {
  this._readLock.push(expression);
  return this;
};
Selector.prototype.forUpdate = function() {
  this._writeLockAll = true;
  return this;
};
Selector.prototype.forUpdateOf = function(expression) {
  this._writeLock.push(expression);
  return this;
};
Selector.prototype.resetFields = function() {
  this._fields = [];
  return this;
};
Selector.prototype.addField = function(expression, alias, options) {
  var self = this;
  var processOption = function(option) {
    if (option == "distinct") {
      if (alias == null) self.addDistinctOn(expression);
      else self.addDistinctOn(['"$"', alias]);
    } else if (option == "grouped") {
      if (alias == null) self.addGroupBy(expression);
      else self.addGroupBy(['"$"', alias]);
    } else {
      throw "Unexpected option passed to addField(...).";
    }
  }
  if (alias == null) this._fields.push(expression);
  else this._fields.push(['$ AS "$"', expression, alias]);
  if (options != null) {
    if (options instanceof Array) options.forEach(processOption);
    else processOption(options);
  }
  return this;
};
Selector.prototype.join = Selector.prototype.addFrom;
Selector.prototype.from = function(expression, alias, condition) {
  if (this._from.length > 0) {
    error();
  }
  return this.addFrom(expression, alias, condition);
};
Selector.prototype.leftJoin = function(expression, alias, condition) {
  var first = this._from.length == 0;
  if (!first) this._from.push('LEFT OUTER JOIN');
  if (alias == null) this._from.push(expression);
  else this._from.push(['$ AS "$"', expression, alias]);
  if (condition != null) {
    if (first) {
      this.addWhere(condition);
    } else {
      this._from.push('ON');
      this._from.push(condition);
    }
  }
};
Selector.prototype.union = function(expression) {
  this.addCombine(['UNION $', expression]);
  return this;
};
Selector.prototype.unionAll = function(expression) {
  this.addCombine(['UNION ALL $', expression]);
  return this;
};
Selector.prototype.intersect = function(expression) {
  this.addCombine(['INTERSECT $', expression]);
  return this;
};
Selector.prototype.intersectAll = function(expression) {
  this.addCombine(['INTERSECT ALL $', expression]);
  return this;
};
Selector.prototype.except = function(expression) {
  this.addCombine(['EXCEPT $', expression]);
  return this;
};
Selector.prototype.exceptAll = function(expression) {
  this.addCombine(['EXCEPT ALL $', expression]);
  return this;
};
Selector.prototype.toStructure = function() {
  var parts = [];
  parts.push('SELECT');
  if (this._distinct) parts.push('DISTINCT');
  else if (this._distinctOn.length > 0)
    parts.push(['DISTINCT ON ($$)', ', ', this._distinctOn]);
  parts.push(["$$", ", ", this._fields]);
  if (this._from.length > 0)    parts.push(['FROM $$',     ' ',     this._from]);
  if (this._where.length > 0)   parts.push(['WHERE $$',    ' AND ', this._where]);
  if (this._groupBy.length > 0) parts.push(['GROUP BY $$', ', ',    this._groupBy]);
  if (this._having.length > 0)  parts.push(['HAVING $$',   ' AND ', this._having]);
  this._combine.forEach(function(entry) { parts.push(entry); });
  if (this._orderBy.length > 0) parts.push(['ORDER BY $$', ', ',    this._orderBy]);
  if (this._limit != null)      parts.push(['LIMIT ?',  this._limit]);
  if (this._offset != null)     parts.push(['OFFSET ?', this._offset]);
  if (this._writeLockAll) parts.push('FOR UPDATE');
  else {
    if (this._readLockAll) parts.push('FOR SHARE');
    else if (this._readLock.length > 0)
      parts.push(['FOR SHARE OF $$', ', ', this._readLock]);
    if (this._writeLock.length > 0)
      parts.push(['FOR UPDATE OF $$', ', ', this._writeLock]);
  }
  return ["$$", " ", parts];
};

function SQLInsert(table) {
  this._with = [];
  if (table == null) this._table = null;
  else this._table = table;
  this._columns = [];
  this._values = [];
  this._query = null;
  this._returning = [];
}
SQLInsert.prototype = new SQLQuery();
SQLInsert.prototype.addWith = Selector.prototype.addWith;
SQLInsert.prototype.table = function(expression) {
  this._table = expression;
  return this;
};
SQLInsert.prototype.addValues = function(mapping) {
  if (this._query != null) throw "Cannot combine query with values.";
  for (key in mapping) {
    this._columns.push(key);
    this._values.push(['?', mapping[key]]);
  }
};
SQLInsert.prototype.addValueExpressions = function(mapping) {
  if (this._query != null) throw "Cannot combine query with values.";
  for (key in mapping) {
    this._columns.push(key);
    this._values.push(mapping[key]);
  }
};
SQLInsert.prototype.query = function(columns, expression) {
  if (this._values.length > 0) throw "Cannot combine query with values.";
  this._columns = columns;
  this._select = expression;
};
SQLInsert.prototype.addReturning = function(expression, alias) {
  if (alias == null) this._returning.push(expression);
  else this._returning.push(['$ AS "$"', expression, alias]);
};
SQLInsert.prototype.toStructure = function() {
  var parts = [];
  parts.push('INSERT INTO');
  if (this._table == null) throw "Missing table for INSERT.";
  parts.push(this._table);
  if (this._columns.length > 0) parts.push(['($$)', ', ', this._columns]);
  if (this._values.length > 0) parts.push(['VALUES ($$)', ', ', this._values]);
  else if (this._query == null) parts.push('DEFAULT VALUES');
  else parts.push(this._query);
  if (this._returning.length > 0)
    parts.push(['RETURNING $$', ', ', this._returning]);
  return ["$$", " ", parts];
};

function SQLUpdate(table) {
  this._with = [];
  if (table == null) this._table = null;
  else this._table = table;
  this._columns = [];
  this._values = [];
  this._query = null;
  this._from = [];
  this._where = [];
  this._returning = [];
}
SQLUpdate.prototype = new SQLQuery();
SQLUpdate.prototype.addWith = Selector.prototype.addWith;
SQLUpdate.prototype.table = function(expression, alias) {
  if (alias == null) this._table = expression;
  else this._table = ['$ AS "$"', expression, alias];
  return this;
}
SQLUpdate.prototype.addValues = SQLInsert.prototype.addValues;
SQLUpdate.prototype.addValueExpressions = SQLInsert.prototype.addValueExpressions;
SQLUpdate.prototype.query = SQLInsert.prototype.query;
SQLUpdate.prototype.addFrom = Selector.prototype.addFrom;
SQLUpdate.prototype.join = Selector.prototype.addFrom;
SQLUpdate.prototype.leftJoin = function(expression, alias, condition) {
  if (this._from.length == 0)
    throw "First join for UPDATE or DELETE must not be a left join.";
  this._from.push('LEFT OUTER JOIN');
  if (alias == null) this._from.push(expression);
  else this._from.push(['$ AS "$"', expression, alias]);
  if (condition != null) {
    this._from.push('ON');
    this._from.push(condition);
  }
};
SQLUpdate.prototype.addWhere = Selector.prototype.addWhere;
SQLUpdate.prototype.addReturning = SQLInsert.prototype.addReturning;
SQLUpdate.prototype.toStructure = function() {
  var parts = [];
  parts.push('UPDATE');
  if (this._table == null) throw "Missing table for UPDATE.";
  parts.push(this._table);
  parts.push('SET');
  if (this._columns.length == 0) throw "Missing columns for UPDATE.";
  if (this._query == null) {
    for (var i=0; i<this._columns.length; i++) {
      parts.push(
        [ (i==this._columns.length-1) ? '$ = $' : '$ = $,',
          this._columns[i],
          this._values[i]]
      );
    }
  } else {
    parts.push(['($$) = ($$)', ', ', this._columns, ', ', this._values]);
  }
  if (this._from.length > 0) parts.push(['FROM $$', ' ', this._from]);
  if (this._where.length > 0) parts.push(['WHERE $$', ' AND ', this._where]);
  if (this._returning.length > 0)
    parts.push(['RETURNING $$', ', ', this._returning]);
  return ["$$", " ", parts];
};

function SQLDelete(table) {
  this._with = [];
  if (table == null) this._table = null;
  else this._table = table;
  this._from = [];  // USING clause
  this._where = [];
  this._returning = [];
}
SQLDelete.prototype = new SQLQuery();
SQLDelete.prototype.addWith = Selector.prototype.addWith;
SQLDelete.prototype.table = SQLUpdate.prototype.table;
SQLDelete.prototype.addValues = SQLInsert.prototype.addValues;
SQLDelete.prototype.addValueExpressions = SQLInsert.prototype.addValueExpressions;
SQLDelete.prototype.addFrom = Selector.prototype.addFrom;
SQLDelete.prototype.addUsing = Selector.prototype.addFrom;
SQLDelete.prototype.join = Selector.prototype.addFrom;
SQLDelete.prototype.leftJoin = SQLUpdate.prototype.leftJoin;
SQLDelete.prototype.addWhere = Selector.prototype.addWhere;
SQLDelete.prototype.addReturning = SQLInsert.prototype.addReturning;
SQLDelete.prototype.toStructure = function() {
  var parts = [];
  parts.push('DELETE FROM');
  if (this._table == null) throw "Missing table for DELETE.";
  parts.push(this._table);
  if (this._from.length > 0) parts.push(['USING $$', ' ', this._from]);
  if (this._where.length > 0) parts.push(['WHERE $$', ' AND ', this._where]);
  if (this._returning.length > 0)
    parts.push(['RETURNING $$', ', ', this._returning]);
  return ["$$", " ", parts];
};

function Upserter(table, keys) {
  if (table == null) this._table = null;
  else this._table = table;
  this._columns = [];
  this._values = [];
  this._keys = [];
  if (keys) this.addKeys(keys);
}

Upserter.prototype.addValues = SQLInsert.prototype.addValues;
Upserter.prototype.addValueExpressions = SQLInsert.prototype.addValueExpressions;
Upserter.prototype.addKeys = function(keys) {
  var self = this;
  keys.forEach(function(key) { self._keys.push(key); });
};
Upserter.prototype.applyWhere = function(sqlQuery) {
  for (var i=0; i<this._columns.length; i++) {
    var column = this._columns[i];
    var value = this._values[i];
    for (var j=0; j<this._keys.length; j++) if (this._keys[j] == column) break;
    if (j<this._keys.length) sqlQuery.addWhere(['$ = $', column, value]);
  }
}
Upserter.prototype.getSelector = function() {
  var selector = new Selector(this._table).addField('NULL');
  this.applyWhere(selector);
  return selector;
}
Upserter.prototype.getSQLInsert = function() {
  var sqlInsert = new SQLInsert(this._table);
  sqlInsert._columns = this._columns;
  sqlInsert._values = this._values;
  return sqlInsert;
}
Upserter.prototype.getSQLUpdate = function() {
  var sqlUpdate = new SQLUpdate(this._table);
  for (var i =0; i<this._columns.length; i++) {
    var column = this._columns[i];
    var value = this._values[i];
    for (var j=0; j<this._keys.length; j++) if (this._keys[j] == column) break;
    if (j==this._keys.length) {
      sqlUpdate._columns.push(column);
      sqlUpdate._values.push(value);
    }
  }
  if (sqlUpdate._columns.length == 0) return null;
  this.applyWhere(sqlUpdate);
  return sqlUpdate;
}


exports.SQLQuery = SQLQuery;
exports.Selector = Selector;
exports.Upserter = Upserter;
exports.SQLInsert = SQLInsert;
exports.SQLUpdate = SQLUpdate;
exports.SQLDelete = SQLDelete;

