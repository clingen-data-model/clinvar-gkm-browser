# Generate reference-checks.sql from schema.sql: one anti-join per REFERENCES clause, recording
# dangling values in reference_issue. Covers enforced clauses and ones written in a comment as
#   -- REFERENCES parent (column) NOT ENFORCED: <reason>
# which apply to the next column definition. Single-column references only.
#
# Usage: awk -f reference-checks.awk schema.sql > reference-checks.sql

function emit(child, col, parent, pcol) {
    printf "INSERT INTO reference_issue\n"
    printf "SELECT '%s', '%s', '%s', '%s', CAST(c.%s AS VARCHAR), count(*)\n", child, col, parent, pcol, col
    printf "FROM %s c ANTI JOIN %s p ON p.%s = c.%s\n", child, parent, pcol, col
    printf "WHERE c.%s IS NOT NULL GROUP BY c.%s;\n\n", col, col
}

match($0, /^CREATE TABLE [a-z_]+/) {
    table = substr($0, 14, RLENGTH - 13)
    pending = ""
    next
}

# A reference declared in a comment applies to the next column.
/^ *-- REFERENCES [a-z_]+ \([a-z_]+\) NOT ENFORCED/ {
    match($0, /REFERENCES [a-z_]+ \([a-z_]+\)/)
    pending = substr($0, RSTART + 11, RLENGTH - 11)
    next
}

/^ *--/ { next }

table != "" && /^    [a-z_]+ / {
    col = $1
    ref = ""
    if (match($0, /REFERENCES [a-z_]+ \([a-z_]+\)/)) {
        ref = substr($0, RSTART + 11, RLENGTH - 11)
    } else if (pending != "") {
        ref = pending
    }
    pending = ""
    if (ref != "") {
        split(ref, parts, /[ ()]+/)
        emit(table, col, parts[1], parts[2])
    }
}

/^\);/ { table = "" }
