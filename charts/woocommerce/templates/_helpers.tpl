{{/*
Expand the name of the chart.
*/}}
{{- define "woocommerce.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "woocommerce.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create a default fully qualified WordPress name or service name.
*/}}
{{- define "woocommerce.wordpress.fullname" -}}
{{- if .Values.wordpress.nameOverride }}
{{- .Values.wordpress.nameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
wordpress
{{- end }}
{{- end }}

{{/*
Create a default fully qualified MariaDB name or service name.
*/}}
{{- define "woocommerce.mariadb.fullname" -}}
{{- if .Values.mariadb.nameOverride }}
{{- .Values.mariadb.nameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
mariadb
{{- end }}
{{- end }}

{{/*
Create Secret name for MariaDB credentials.
*/}}
{{- define "woocommerce.mariadb.secretName" -}}
{{- if .Values.mariadb.auth.existingSecret }}
{{- .Values.mariadb.auth.existingSecret }}
{{- else }}
{{- printf "%s-mariadb-secret" (include "woocommerce.mariadb.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Create Secret name for WordPress Admin credentials.
*/}}
{{- define "woocommerce.wordpress.secretName" -}}
{{- if .Values.wordpress.auth.existingSecret }}
{{- .Values.wordpress.auth.existingSecret }}
{{- else }}
{{- printf "%s-admin-secret" (include "woocommerce.wordpress.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Common labels for chart
*/}}
{{- define "woocommerce.labels" -}}
helm.sh/chart: {{ include "woocommerce.chart" . }}
{{ include "woocommerce.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels for chart
*/}}
{{- define "woocommerce.selectorLabels" -}}
app.kubernetes.io/name: {{ include "woocommerce.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
WordPress Common labels
*/}}
{{- define "woocommerce.wordpress.labels" -}}
helm.sh/chart: {{ include "woocommerce.chart" . }}
{{ include "woocommerce.wordpress.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
WordPress Selector labels
*/}}
{{- define "woocommerce.wordpress.selectorLabels" -}}
app.kubernetes.io/name: {{ include "woocommerce.wordpress.fullname" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: storefront
{{- end }}

{{/*
MariaDB Common labels
*/}}
{{- define "woocommerce.mariadb.labels" -}}
helm.sh/chart: {{ include "woocommerce.chart" . }}
{{ include "woocommerce.mariadb.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
MariaDB Selector labels
*/}}
{{- define "woocommerce.mariadb.selectorLabels" -}}
app.kubernetes.io/name: {{ include "woocommerce.mariadb.fullname" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: database
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "woocommerce.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}
