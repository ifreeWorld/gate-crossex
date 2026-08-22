#!/usr/bin/env bash
set -euo pipefail

# Gate CrossEx Google Cloud VM connection helper.
#
# First use, or when the Google login has expired:
#   gcloud auth login wangzilong13991@gmail.com
#
# Normal interactive SSH connection:
#   bash gcloud.sh
#
# Connect and forward the private Gate CrossEx web UI to this Mac:
#   bash gcloud.sh tunnel
# Then open http://127.0.0.1:27840 in the Mac browser and keep this shell open.
# Local port 17840 stays free for running the development checkout on this Mac.

ACCOUNT="wangzilong13991@gmail.com"
PROJECT="project-d47dd35b-3573-43da-bf2"
INSTANCE="instance-20260809-014606"
ZONE="asia-east2-a"

# A previous gcloud configuration used an unrelated service account. Ensure it
# cannot silently override the personal account selected below.
gcloud config unset auth/impersonate_service_account >/dev/null 2>&1 || true
gcloud config set account "$ACCOUNT"
gcloud config set project "$PROJECT"

echo "Connecting to $INSTANCE in $ZONE as $ACCOUNT"
gcloud compute instances describe "$INSTANCE" \
  --zone="$ZONE" \
  --format='table(name,status,machineType.basename(),networkInterfaces[0].accessConfigs[0].natIP:label=EXTERNAL_IP)'

case "${1:-ssh}" in
  ssh)
    gcloud compute ssh "$INSTANCE" --zone="$ZONE"
    ;;
  tunnel)
    # Compress the JSON-heavy web traffic carried over the higher-latency SSH link.
    gcloud compute ssh "$INSTANCE" --zone="$ZONE" -- \
      -C -L 27840:127.0.0.1:17840
    ;;
  *)
    echo "Usage: bash gcloud.sh [ssh|tunnel]" >&2
    exit 2
    ;;
esac
