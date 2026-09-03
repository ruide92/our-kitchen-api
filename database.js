const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dbPath = path.join(__dirname, 'database.json');

// 简单的JSON数据库，模拟SQLite API
class JsonDatabase {
  constructor() {
    this.data = {};
    this.load();
  }

  load() {
    if (fs.existsSync(dbPath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      } catch (e) {
        this.data = {};
      }
    }
    this.initTables();
  }

  save() {
    fs.writeFileSync(dbPath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  initTables() {
    const tables = ['users', 'families', 'family_members', 'dishes', 'fridge_items', 
                    'shopping_items', 'weekly_menu', 'order_items', 'favorites', 
                    'dish_ratings', 'condiments'];
    tables.forEach(table => {
      if (!this.data[table]) this.data[table] = [];
    });
    this.save();
  }

  // 简单的SQL解析和执行（只支持项目中用到的SQL）
  prepare(sql) {
    return new Statement(this, sql);
  }

  exec(sql) {
    // 只用于CREATE TABLE，已经在initTables中处理
    return null;
  }

  pragma() {
    return null;
  }
}

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.trim();
  }

  // 解析WHERE条件（修复版：提前取出参数，避免filter内部多次调用消耗params）
  parseWhere(whereStr, params) {
    // 简单处理：AND连接的条件
    const conditions = whereStr.split(/\s+AND\s+/i);
    // 先解析所有条件，提前取出参数值
    const parsedConditions = conditions.map(cond => {
      cond = cond.trim();
      // 处理 = ?
      const eqMatch = cond.match(/^(\w+)\s*=\s*\?$/);
      if (eqMatch) {
        const field = eqMatch[1];
        const value = params.shift();
        return { type: 'eq', field, value };
      }
      // 处理 LIKE ?
      const likeMatch = cond.match(/^(\w+)\s+LIKE\s+\?$/i);
      if (likeMatch) {
        const field = likeMatch[1];
        const value = params.shift();
        const pattern = value.replace(/%/g, '.*');
        return { type: 'like', field, pattern };
      }
      // 处理 >= ?
      const gteMatch = cond.match(/^(\w+)\s*>=\s*\?$/);
      if (gteMatch) {
        const field = gteMatch[1];
        const value = params.shift();
        return { type: 'gte', field, value };
      }
      // 处理 IS NOT NULL
      const notNullMatch = cond.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i);
      if (notNullMatch) {
        const field = notNullMatch[1];
        return { type: 'notNull', field };
      }
      return null;
    }).filter(Boolean);
    
    return (item) => {
      return parsedConditions.every(cond => {
        if (cond.type === 'eq') {
          return String(item[cond.field]) === String(cond.value);
        }
        if (cond.type === 'like') {
          return new RegExp(cond.pattern, 'i').test(item[cond.field] || '');
        }
        if (cond.type === 'gte') {
          return Number(item[cond.field]) >= Number(cond.value);
        }
        if (cond.type === 'notNull') {
          return item[cond.field] !== null && item[cond.field] !== undefined && item[cond.field] !== '';
        }
        return true;
      });
    };
  }

  get(...params) {
    const result = this.all(...params);
    return result[0] || undefined;
  }

  all(...params) {
    const sql = this.sql.toUpperCase();
    
    // SELECT查询
    if (sql.startsWith('SELECT')) {
      // 检查是否DISTINCT
      const isDistinct = /SELECT\s+DISTINCT/i.test(this.sql);
      
      // 提取表名
      const fromMatch = this.sql.match(/FROM\s+(\w+)/i);
      if (!fromMatch) return [];
      const table = fromMatch[1];
      let items = this.db.data[table] || [];

      // WHERE条件 - 先移除ORDER和LIMIT，再提取WHERE
      let sqlForWhere = this.sql.replace(/\s+ORDER\s+BY.+$/i, '').replace(/\s+LIMIT.+$/i, '');
      const whereMatch = sqlForWhere.match(/WHERE\s+(.+)$/i);
      if (whereMatch) {
        const whereStr = whereMatch[1].trim();
        const filter = this.parseWhere(whereStr, [...params]);
        items = items.filter(filter);
      }

      // DISTINCT去重
      if (isDistinct) {
        const distinctMatch = this.sql.match(/SELECT\s+DISTINCT\s+(\w+)/i);
        if (distinctMatch) {
          const field = distinctMatch[1];
          const seen = new Set();
          items = items.filter(item => {
            const val = item[field];
            if (val === null || val === undefined || val === '') return false;
            if (seen.has(val)) return false;
            seen.add(val);
            return true;
          });
        }
      }

      // ORDER BY
      const orderMatch = this.sql.match(/ORDER\s+BY\s+(\w+)(?:\s+(DESC|ASC))?/i);
      if (orderMatch) {
        const field = orderMatch[1];
        const dir = orderMatch[2]?.toUpperCase() === 'DESC' ? -1 : 1;
        items = [...items].sort((a, b) => {
          if (a[field] < b[field]) return -1 * dir;
          if (a[field] > b[field]) return 1 * dir;
          return 0;
        });
      }

      // LIMIT OFFSET
      const limitMatch = this.sql.match(/LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i);
      if (limitMatch) {
        const limit = parseInt(limitMatch[1]);
        const offset = parseInt(limitMatch[2] || 0);
        items = items.slice(offset, offset + limit);
      }

      return items;
    }

    return [];
  }

  run(...params) {
    const sql = this.sql.toUpperCase();

    // INSERT
    if (sql.startsWith('INSERT')) {
      const tableMatch = this.sql.match(/INTO\s+(\w+)/i);
      const fieldsMatch = this.sql.match(/\(([^)]+)\)/);
      if (tableMatch && fieldsMatch) {
        const table = tableMatch[1];
        const fields = fieldsMatch[1].split(',').map(f => f.trim());
        const item = {};
        fields.forEach((field, i) => {
          item[field] = params[i];
        });
        if (!item.id) item.id = crypto.randomUUID();
        if (!item.created_at) item.created_at = new Date().toISOString();
        this.db.data[table].push(item);
        this.db.save();
        return { lastInsertRowid: item.id };
      }
    }

    // UPDATE
    if (sql.startsWith('UPDATE')) {
      const tableMatch = this.sql.match(/UPDATE\s+(\w+)/i);
      const setMatch = this.sql.match(/SET\s+(.+?)\s+WHERE/i);
      const whereMatch = this.sql.match(/WHERE\s+(.+)$/i);
      if (tableMatch && setMatch && whereMatch) {
        const table = tableMatch[1];
        // 解析SET子句（处理COALESCE）
        const setStr = setMatch[1];
        const setParts = setStr.split(',').map(s => s.trim());
        const updates = {};
        setParts.forEach(part => {
          const coalesceMatch = part.match(/(\w+)\s*=\s*COALESCE\(\?,\s*\1\)/i);
          if (coalesceMatch) {
            const field = coalesceMatch[1];
            const value = params.shift();
            if (value !== null && value !== undefined) {
              updates[field] = value;
            }
          } else {
            const eqMatch = part.match(/(\w+)\s*=\s*\?/);
            if (eqMatch) {
              updates[eqMatch[1]] = params.shift();
            }
          }
        });
        // 解析WHERE
        const filter = this.parseWhere(whereMatch[1], [...params]);
        let count = 0;
        this.db.data[table].forEach(item => {
          if (filter(item)) {
            Object.assign(item, updates);
            count++;
          }
        });
        this.db.save();
        return { changes: count };
      }
    }

    // DELETE
    if (sql.startsWith('DELETE')) {
      const tableMatch = this.sql.match(/FROM\s+(\w+)/i);
      const whereMatch = this.sql.match(/WHERE\s+(.+)$/i);
      if (tableMatch) {
        const table = tableMatch[1];
        if (whereMatch) {
          const filter = this.parseWhere(whereMatch[1], [...params]);
          const before = this.db.data[table].length;
          this.db.data[table] = this.db.data[table].filter(item => !filter(item));
          this.db.save();
          return { changes: before - this.db.data[table].length };
        } else {
          this.db.data[table] = [];
          this.db.save();
          return { changes: 0 };
        }
      }
    }

    return { changes: 0 };
  }
}

const db = new JsonDatabase();
console.log('JSON数据库初始化完成');

module.exports = db;
