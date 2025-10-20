from __future__ import annotations

from typing import Any, Dict, Optional, Tuple, Union

import httpx

REGION_LABEL_KEY = "minoots.io/region"


class MinootsClient:
    """Lightweight HTTP client for the MINOOTS control plane."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        tenant_id: str,
        default_region: Optional[str] = None,
        default_requested_by: str = "agent:minoots",
        timeout: float = 10.0,
        sync_client: Optional[httpx.Client] = None,
        async_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._tenant_id = tenant_id
        self._default_region = _sanitize(default_region)
        self._default_requested_by = default_requested_by
        self._timeout = timeout
        self._sync_client = sync_client
        self._async_client = async_client

    def schedule_timer(
        self,
        *,
        name: str,
        requested_by: Optional[str] = None,
        duration: Optional[Union[str, int]] = None,
        fire_at: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        labels: Optional[Dict[str, str]] = None,
        action_bundle: Optional[Dict[str, Any]] = None,
        agent_binding: Optional[Dict[str, Any]] = None,
        region: Optional[str] = None,
        ecosystem: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        payload, header_region = self._build_payload(
            name=name,
            requested_by=requested_by,
            duration=duration,
            fire_at=fire_at,
            metadata=metadata,
            labels=labels,
            action_bundle=action_bundle,
            agent_binding=agent_binding,
            region=region,
            ecosystem=ecosystem,
        )
        response = self._send_sync(payload, header_region)
        return response.json()

    async def schedule_timer_async(
        self,
        *,
        name: str,
        requested_by: Optional[str] = None,
        duration: Optional[Union[str, int]] = None,
        fire_at: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        labels: Optional[Dict[str, str]] = None,
        action_bundle: Optional[Dict[str, Any]] = None,
        agent_binding: Optional[Dict[str, Any]] = None,
        region: Optional[str] = None,
        ecosystem: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        payload, header_region = self._build_payload(
            name=name,
            requested_by=requested_by,
            duration=duration,
            fire_at=fire_at,
            metadata=metadata,
            labels=labels,
            action_bundle=action_bundle,
            agent_binding=agent_binding,
            region=region,
            ecosystem=ecosystem,
        )
        response = await self._send_async(payload, header_region)
        return response.json()

    # Internal helpers -----------------------------------------------------

    def _build_payload(
        self,
        *,
        name: str,
        requested_by: Optional[str],
        duration: Optional[Union[str, int]],
        fire_at: Optional[str],
        metadata: Optional[Dict[str, Any]],
        labels: Optional[Dict[str, str]],
        action_bundle: Optional[Dict[str, Any]],
        agent_binding: Optional[Dict[str, Any]],
        region: Optional[str],
        ecosystem: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Dict[str, Any], Optional[str]]:
        if duration is None and fire_at is None:
            raise ValueError("Either duration or fire_at must be provided")

        payload: Dict[str, Any] = {
            "tenantId": self._tenant_id,
            "name": name,
            "requestedBy": requested_by or self._default_requested_by,
        }
        if duration is not None:
            payload["duration"] = duration
        if fire_at is not None:
            payload["fireAt"] = fire_at
        if metadata:
            payload["metadata"] = metadata
        if action_bundle:
            payload["actionBundle"] = action_bundle
        if agent_binding:
            payload["agentBinding"] = agent_binding
        if ecosystem:
            payload["ecosystem"] = ecosystem

        timer_labels = dict(labels or {})
        header_region = _sanitize(region) or self._default_region
        if header_region and REGION_LABEL_KEY not in timer_labels:
            timer_labels[REGION_LABEL_KEY] = header_region
        if timer_labels:
            payload["labels"] = timer_labels

        return payload, header_region

    def _send_sync(self, payload: Dict[str, Any], region: Optional[str]) -> httpx.Response:
        headers = self._build_headers(region)
        if self._sync_client:
            response = self._sync_client.post(
                f"{self._base_url}/timers",
                json=payload,
                headers=headers,
                timeout=self._timeout,
            )
        else:
            with httpx.Client(timeout=self._timeout) as client:
                response = client.post(
                    f"{self._base_url}/timers",
                    json=payload,
                    headers=headers,
                    timeout=self._timeout,
                )
        response.raise_for_status()
        return response

    async def _send_async(self, payload: Dict[str, Any], region: Optional[str]) -> httpx.Response:
        headers = self._build_headers(region)
        if self._async_client:
            response = await self._async_client.post(
                f"{self._base_url}/timers",
                json=payload,
                headers=headers,
                timeout=self._timeout,
            )
        else:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    f"{self._base_url}/timers",
                    json=payload,
                    headers=headers,
                    timeout=self._timeout,
                )
        response.raise_for_status()
        return response

    def _build_headers(self, region: Optional[str]) -> Dict[str, str]:
        headers = {
            "x-api-key": self._api_key,
            "accept": "application/json",
            "content-type": "application/json",
        }
        if region:
            headers["x-minoots-region"] = region
        return headers


def _sanitize(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None
