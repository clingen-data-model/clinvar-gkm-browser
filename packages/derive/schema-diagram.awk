# Generate a Mermaid ER diagram of one area of schema.sql from its REFERENCES clauses, read as
# reference-checks.awk reads them (including `-- REFERENCES parent (column) NOT ENFORCED`
# comments, drawn dashed). An area's diagram has the references from its own tables; the tables
# they point to in other areas appear too. References to the vocabularies are left out.
#
# Cardinality: the parent side is exactly one when the column is NOT NULL (or the key), else zero
# or one; the child side is zero or one when the column is the child's primary key, else many.
# The label is the column, unless it has the parent column's name.
#
# Usage: awk -v area=variant|submission -f schema-diagram.awk schema.sql
# (The condition tables declare no references of their own; they appear in the submission area.)

BEGIN {
    split("sequenceReference location allele copyNumberCount copyNumberChange variant variant_gene variant_hgvs variant_xref gene", t, " ")
    for (i in t) area_of[t[i]] = "variant"
    split("submitter scv scv_condition vcv_statement rcv_statement scv_classification_pair", t, " ")
    for (i in t) area_of[t[i]] = "submission"
    split("classification_type classification_term submission_level review_status", t, " ")
    for (i in t) vocabulary[t[i]] = 1
    n = 0
}

match($0, /^CREATE TABLE [A-Za-z_]+/) {
    table = substr($0, 14, RLENGTH - 13)
    pending = ""
    next
}

/^ *-- REFERENCES [A-Za-z_]+ \([a-z_]+\) NOT ENFORCED/ {
    match($0, /REFERENCES [A-Za-z_]+ \([a-z_]+\)/)
    pending = substr($0, RSTART + 11, RLENGTH - 11)
    next
}

/^ *--/ { next }

table != "" && /^    [a-z][A-Za-z_]* / {
    col = $1
    ref = ""
    enforced = 1
    if (match($0, /REFERENCES [A-Za-z_]+ \([a-z_]+\)/)) {
        ref = substr($0, RSTART + 11, RLENGTH - 11)
    } else if (pending != "") {
        ref = pending
        enforced = 0
    }
    pending = ""
    if (ref == "") next
    split(ref, parts, /[ ()]+/)
    if (parts[1] in vocabulary || area_of[table] != area) next
    key = $0 ~ /PRIMARY KEY/
    required = key || $0 ~ /NOT NULL/
    n++
    edge[n] = sprintf("  %s %s%s%s %s : \"%s\"", parts[1], required ? "||" : "|o",
                      enforced ? "--" : "..", key ? "o|" : "o{", table,
                      col == parts[2] ? "" : col (enforced ? "" : ", not enforced"))
}

/^\);/ { table = "" }

END {
    if (n == 0) {
        print "schema-diagram.awk: no references for area '" area "'" > "/dev/stderr"
        exit 1
    }
    print "erDiagram"
    for (i = 1; i <= n; i++) print edge[i]
}
