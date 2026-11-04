use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use std::path::Path;
use std::sync::Mutex;

/// One connection guarded by a mutex: the app is single-user, and a single
/// connection keeps multi-statement transactions on the same handle.
pub struct DbState(pub Mutex<Connection>);

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    )?;
    Ok(conn)
}

#[derive(Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub changes: u64,
    pub last_insert_id: i64,
}

fn to_sql(v: &Value) -> Result<SqlValue, String> {
    Ok(match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().ok_or("number out of range")?),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        Value::Array(_) | Value::Object(_) => {
            return Err("arrays and objects cannot be SQL parameters".into())
        }
    })
}

pub(crate) fn params(values: &[Value]) -> Result<Vec<SqlValue>, String> {
    values.iter().map(to_sql).collect()
}

pub(crate) fn to_json(v: ValueRef) -> Result<Value, String> {
    Ok(match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => return Err("blob columns are not supported".into()),
    })
}

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

/// Runs a query and returns its rows as JSON objects. Shared with the import's staging reader.
pub(crate) fn query_rows(
    conn: &Connection,
    sql: &str,
    params: &[Value],
) -> Result<Vec<Map<String, Value>>, String> {
    let mut stmt = conn.prepare(sql).map_err(err)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt
        .query(params_from_iter(self::params(params)?))
        .map_err(err)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(err)? {
        let mut obj = Map::new();
        for (i, name) in names.iter().enumerate() {
            obj.insert(name.clone(), to_json(row.get_ref(i).map_err(err)?)?);
        }
        out.push(obj);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_query(
    state: tauri::State<DbState>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    query_rows(&conn, &sql, &params)
}

#[tauri::command]
pub fn db_execute(
    state: tauri::State<DbState>,
    sql: String,
    params: Vec<Value>,
) -> Result<ExecResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let changes = conn
        .execute(&sql, params_from_iter(self::params(&params)?))
        .map_err(err)?;
    Ok(ExecResult {
        changes: changes as u64,
        last_insert_id: conn.last_insert_rowid(),
    })
}

#[tauri::command]
pub fn db_batch(state: tauri::State<DbState>, statements: Vec<Statement>) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(err)?;
    for s in &statements {
        tx.execute(&s.sql, params_from_iter(params(&s.params)?))
            .map_err(err)?;
    }
    tx.commit().map_err(err)
}
